import express from "express";
import logger from "./utils/logger";
import connectdb from "./config/db";
import Stock from "./model/stock.model";
import router from "./routes";
import OrderReservation from "./model/orderReservation.model";
import dotenv from "dotenv";
dotenv.config();

import { startOrderReservationEventService } from "./handler/handleOrderReservationEvent";
import { startPaymentSuccessEventService } from "./handler/handlePaymentSuccessEvent";
import { startProductStockInitializationEventService } from "./handler/handleProductStockInitializationEvent";
import { startProductStockDeletionEventService } from "./handler/handleStockDeleteEvent";
import { startPaymentFailureEventService } from "./handler/handlePaymentFailure.Event";
import { closeBroker } from "./rabbitmq/connection";
import ProcessedEvent from "./model/processedEvent.model";
import OutboxEvent from "./model/outbox.model";
import { startOutboxRelay, stopOutboxRelay } from "./rabbitmq/outbox";
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
initMetrics("inventory-service");

const app = express();

(async () => {
  try {
    await connectdb.authenticate();
    logger.info("Connection successful");

    await Stock.sync({ alter: true });
    logger.info("Stocks table synced");

    await OrderReservation.sync({ alter: true });
    logger.info("OrderReservation table synced");
    await ProcessedEvent.sync({ alter: true });
    logger.info("ProcessedEvent table synced");
    await OutboxEvent.sync({ alter: true });
    logger.info("Outbox table synced");
    startOutboxRelay();
    startQueueMonitor();
  } catch (error) {
    logger.error("Error during DB setup: %o", error);
    process.exit(1);
  }
})();

/* handlers */
startOrderReservationEventService();
startPaymentSuccessEventService();
startProductStockInitializationEventService();
startProductStockDeletionEventService();
startPaymentFailureEventService();

/*
 * Correlation first: anything mounted above it logs without a correlationId,
 * and an inbound x-correlation-id has to be honoured before a handler runs.
 */
app.use(correlationMiddleware());
app.use(requestLogger({ logger }));
app.use(express.json());

/* Probes and metrics sit outside /api/v1 - they are for operators, not clients. */
app.get("/health", healthHandler("inventory-service"));
app.get("/ready", readyHandler("inventory-service", dependencies));
app.get("/metrics", metricsHandler());

app.use("/api/v1", router);
const PORT = process.env.PORT || 5002;

console.log("Logger initialized in", process.env.NODE_ENV, "mode");

if (process.env.NODE_ENV !== "test") {
  try {
    app.listen(PORT, () => {
      logger.info(`Server started on port ${PORT} `);
    });
  } catch (error) {
    logger.error("Error starting server: %o", error);
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
