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
} from "@edoms/shared-observability";
import { dependencies } from "./observability";
import { startQueueMonitor, stopQueueMonitor } from "./rabbitmq/queueMonitor";

// Registered before anything can record to it.
initMetrics("payment-service");

const app = express();
(async () => {
  try {
    await connectdb.authenticate();
    logger.info("Connection successful");
    await Payment.sync({ alter: true });
    logger.info("Payment table synced");
    await OutboxEvent.sync({ alter: true });
    logger.info("Outbox table synced");
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
app.use(correlationMiddleware());
app.use(requestLogger({ logger }));
app.use(express.json());

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
