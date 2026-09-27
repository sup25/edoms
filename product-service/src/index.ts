import connectdb from "./config/db";
import express from "express";
import Product from "./model/product.model";
import router from "./routes";

import { EventType } from "@edoms/shared-events";
import { subscribeEvent } from "./rabbitmq/subscriber";
import redis from "./utils/redis";
import { startStockDecrementEventService } from "./handler/handleStockDecrementEvent";
import { startStockRollBackEventService } from "./handler/handleStockRollBackEvent";
import logger from "./utils/logger";
import { closeBroker } from "./rabbitmq/connection";
import OutboxEvent from "./model/outbox.model";
import { startOutboxRelay, stopOutboxRelay } from "./rabbitmq/outbox";

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
      await redis.setex(`stock:${payload.productId}`, 300, String(payload.stock));
      logger.info(`Cache refreshed for product ${payload.productId}`);
    },
    { queue: "product-service.stock-updated" }
  );
}

startService();

/* Subscribe to  event */
startStockDecrementEventService();
startStockRollBackEventService();

app.use(express.json());
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
