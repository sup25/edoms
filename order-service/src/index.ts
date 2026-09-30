// Tracing first: it patches modules as they are required.
import "./tracing";
// Then config: a misconfigured service should fail here, not three
// layers down when something reads an env var that was never set.
import "./config/env";
import sequelize from "./config/db";
import express from "express";
import Order from "./model/order.model";
import router from "./routes";
import { startOrderConfirmEventService } from "./handler/handleOrderConfirmedEvent";
import { startOrderFailureEventService } from "./handler/handlerOrderFailureEvent";
import { startReservationFailedEventService } from "./handler/handleReservationFailedEvent";
import { startProductProjectionService } from "./handler/handleProductProjection";
import ProductProjection from "./model/productProjection.model";
import logger from "./utils/logger";
import { closeBroker } from "./rabbitmq/connection";
import OutboxEvent from "./model/outbox.model";
import { startOutboxRelay, stopOutboxRelay } from "./rabbitmq/outbox";
import { startOrderSagaEventService } from "./handler/handleOrderSagaEvents";
import { startSagaTimeoutWorker, stopSagaTimeoutWorker } from "./handler/orderSagaTimeout";
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
import { startQueueMonitor, stopQueueMonitor } from "./rabbitmq/queueMonitor";

// Registered before anything can record to it.
initMetrics("order-service");

const app = express();
(async () => {
  try {
    await sequelize.authenticate();
    logger.info("Connection successful");

    /*
     * Migrations, not sync({ alter: true }). The old call re-added a
     * unique index on every boot because Sequelize could not recognise
     * the one it made last time - see migrations/0002.
     */
    await runMigrations();
    startSagaTimeoutWorker();
    // Started only after the table exists, otherwise the first poll errors.
    startOutboxRelay();
    startQueueMonitor();
  } catch (error) {
    logger.error("Connection failed:", error);
  }
})();

startOrderConfirmEventService();
startOrderFailureEventService();
startReservationFailedEventService();
startProductProjectionService();
startOrderSagaEventService();

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
app.get("/health", healthHandler("order-service"));
app.get("/ready", readyHandler("order-service", dependencies));
app.get("/metrics", metricsHandler());

app.use("/api/v1", router);
const PORT = process.env.PORT || 5003;

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
    // Stop claiming new rows before the broker connection goes away.
    stopOutboxRelay();
    stopQueueMonitor();
    stopSagaTimeoutWorker();
    await closeBroker();
    await sequelize.close();
    await stopTracing();
  } catch (error) {
    logger.error("Error during shutdown", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app };
