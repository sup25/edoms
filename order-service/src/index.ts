import sequelize from "./config/db";
import express from "express";
import Order from "./model/order.model";
import router from "./routes";
import { startOrderConfirmEventService } from "./handler/handleOrderConfirmedEvent";
import { startOrderFailureEventService } from "./handler/handlerOrderFailureEvent";
import { startReservationFailedEventService } from "./handler/handleReservationFailedEvent";
import { startProductCacheInvalidationService } from "./handler/handleProductCacheInvalidation";
import logger from "./utils/logger";
import { closeBroker } from "./rabbitmq/connection";
import OutboxEvent from "./model/outbox.model";
import { startOutboxRelay, stopOutboxRelay } from "./rabbitmq/outbox";

const app = express();
(async () => {
  try {
    await sequelize.authenticate();
    logger.info("Connection successful");
    await Order.sync({ alter: true });
    logger.info("Order table synced");
    await OutboxEvent.sync({ alter: true });
    logger.info("Outbox table synced");
    // Started only after the table exists, otherwise the first poll errors.
    startOutboxRelay();
  } catch (error) {
    logger.error("Connection failed:", error);
  }
})();

startOrderConfirmEventService();
startOrderFailureEventService();
startReservationFailedEventService();
startProductCacheInvalidationService();

app.use(express.json());
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
    await closeBroker();
    await sequelize.close();
  } catch (error) {
    logger.error("Error during shutdown", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app };
