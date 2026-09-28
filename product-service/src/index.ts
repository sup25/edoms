// Tracing first: it patches modules as they are required.
import "./tracing";
// Then config: a misconfigured service should fail here, not three
// layers down when something reads an env var that was never set.
import "./config/env";
import connectdb from "./config/db";
import express from "express";
import Product from "./model/product.model";
import router from "./routes";

import { EventType } from "@edoms/shared-events";
import { subscribeEvent } from "./rabbitmq/subscriber";
import { cacheWrite } from "./utils/cache";
import redis from "./utils/redis";
import { startStockDecrementEventService } from "./handler/handleStockDecrementEvent";
import { startStockRollBackEventService } from "./handler/handleStockRollBackEvent";
import logger from "./utils/logger";
import { closeBroker } from "./rabbitmq/connection";
import OutboxEvent from "./model/outbox.model";
import { startOutboxRelay, stopOutboxRelay } from "./rabbitmq/outbox";
import {
  correlationMiddleware,
  healthHandler,
  initMetrics,
  metricsHandler,
  readyHandler,
  requestLogger,
  stopTracing,
} from "@edoms/shared-observability";
import { dependencies } from "./observability";
import helmet from "helmet";
import { apiLimiter } from "./middleware/security";
import { startQueueMonitor, stopQueueMonitor } from "./rabbitmq/queueMonitor";

// Registered before anything can record to it.
initMetrics("product-service");

const app = express();
(async () => {
  try {
    await connectdb.authenticate();
    logger.info("Connection successful");
    await Product.sync({ alter: true });
    logger.info("Product table synced");
    await OutboxEvent.sync({ alter: true });
    logger.info("Outbox table synced");
    startOutboxRelay();
    startQueueMonitor();
  } catch (error) {
    logger.error("Error:", error);
    process.exit(1);
  }
})();

/*
 * An admin stock update used to leave this service's Redis cache stale: the
 * event arrived and was only logged (defect #2). It now invalidates the entry
 * so the next read re-fetches.
 */
async function startService() {
  await subscribeEvent<{ productId: number; stock: number }>(
    EventType.STOCK_UPDATED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.STOCK_UPDATED}`, {
        correlationId: meta.correlationId,
      });
      // Non-fatal. Inventory is the source of truth and has already been
      // updated; this only refreshes a cached copy. Letting it throw made a
      // Redis outage dead-letter every stock update - 44 of them, which is
      // how this was found.
      await cacheWrite(`stock:${payload.productId}`, () =>
        redis.setex(`stock:${payload.productId}`, 300, String(payload.stock))
      );
      logger.info(`Cache refreshed for product ${payload.productId}`);
    },
    { queue: "product-service.stock-updated" }
  );
}

startService();

/* Subscribe to  event */
startStockDecrementEventService();
startStockRollBackEventService();

/*
 * Correlation first: anything mounted above it logs without a correlationId,
 * and an inbound x-correlation-id has to be honoured before a handler runs.
 */
/*
 * Security headers before anything else answers. helmet removes the
 * `X-Powered-By: Express` giveaway and sets the usual hardening headers; the
 * default CSP is off because these services return JSON, not documents.
 */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(apiLimiter);

app.use(correlationMiddleware());
app.use(requestLogger({ logger }));
app.use(express.json({ limit: "100kb" }));

/* Probes and metrics sit outside /api/v1 - they are for operators, not clients. */
app.get("/health", healthHandler("product-service"));
app.get("/ready", readyHandler("product-service", dependencies));
app.get("/metrics", metricsHandler());

app.use("/api/v1", router);
const PORT = process.env.PORT || 5001;

if (process.env.NODE_ENV !== "test") {
  try {
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
  }
}

/* Graceful shutdown: stop taking new work, drain in-flight messages. */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  try {
    stopOutboxRelay();
    stopQueueMonitor();
    await closeBroker();
    await stopTracing();
    await connectdb.close();
  } catch (error) {
    logger.error("Error during shutdown", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app };
