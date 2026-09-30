// Tracing first: it patches modules as they are required.
import "./tracing";
// Then config: a misconfigured service should fail here, not three
// layers down when something reads an env var that was never set.
import "./config/env";
import express from "express";
import connectdb from "./config/db";
import Payment from "./model/payment.model";
import router from "./routes";
import logger from "./utils/logger";
import { closeBroker } from "./rabbitmq/connection";
import OutboxEvent from "./model/outbox.model";
import { startOutboxRelay, stopOutboxRelay } from "./rabbitmq/outbox";
import { startOrderReservedEventService } from "./handler/handleOrderReservedEvent";
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
import { runMigrations } from "./config/migrator";
import helmet from "helmet";
import { apiLimiter } from "./middleware/security";
import { stripeWebhookController } from "./controller/stripeWebhook";
import ProcessedWebhook from "./model/processedWebhook.model";
import { startQueueMonitor, stopQueueMonitor } from "./rabbitmq/queueMonitor";

// Registered before anything can record to it.
initMetrics("payment-service");

const app = express();
(async () => {
  try {
    await connectdb.authenticate();
    logger.info("Connection successful");

    /*
     * Migrations, not sync({ alter: true }). The old call re-added a
     * unique index on every boot because Sequelize could not recognise
     * the one it made last time - see migrations/0002.
     */
    await runMigrations();
    startOutboxRelay();
    startQueueMonitor();
    // Payment now reacts to reservations instead of waiting for a client.
    startOrderReservedEventService();
  } catch (error) {
    logger.error("Error:", error);
    process.exit(1);
  }
})();
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

app.use(correlationMiddleware());
app.use(requestLogger({ logger }));

/*
 * The Stripe webhook is mounted here, deliberately ahead of two things.
 *
 * Ahead of express.json, because the signature is computed over the exact
 * bytes Stripe sent - parsing and re-stringifying produces a body that will
 * not verify. It gets express.raw instead.
 *
 * Ahead of the rate limiter, because throttling Stripe means dropping the
 * authoritative record of a charge. It authenticates by signature, so this is
 * not an open door.
 */
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  stripeWebhookController
);

app.use(apiLimiter);
app.use(express.json({ limit: "100kb" }));

/* Probes and metrics sit outside /api/v1 - they are for operators, not clients. */
app.get("/health", healthHandler("payment-service"));
app.get("/ready", readyHandler("payment-service", dependencies));
app.get("/metrics", metricsHandler());

app.use("/api/v1", router);
const PORT = process.env.PORT || 5004;

if (process.env.NODE_ENV !== "test") {
  try {
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Error starting server:", error);
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
