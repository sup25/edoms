import connectdb from "./config/db";
import express from "express";
import Product from "./model/product.model";
import router from "./routes";

import { subscribeEvent } from "./rabbitmq/subscriber";
import { startStockDecrementEventService } from "./handler/handleStockDecrementEvent";
import { startStockRollBackEventService } from "./handler/handleStockRollBackEvent";
import logger from "./utils/logger";
import { closeBroker } from "./rabbitmq/connection";

const app = express();
(async () => {
  try {
    await connectdb.authenticate();
    logger.info("Connection successful");
    await Product.sync({ alter: true });
    logger.info("Product table synced");
  } catch (error) {
    logger.error("Error:", error);
    process.exit(1);
  }
})();

/*
 * Subscribe to stock_updated. This currently only logs.
 * TODO (Phase 2, docs/ROADMAP.md): an admin stock update leaves the Redis
 * `stock:<id>` cache in this service stale. This handler should invalidate it.
 */
async function startService() {
  await subscribeEvent(
    "inventory_service",
    "stock_updated",
    "direct",
    async (eventType: string, data: any) => {
      logger.info(`Received event: ${eventType}`, data);
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
