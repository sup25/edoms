import connectdb from "./config/db";
import express from "express";
import Product from "./model/product.model";
import router from "./routes";

import { subscribeEvent } from "./rabbitmq/subscriber";
import { startStockDecrementEventService } from "./handler/handleStockDecrementEvent";
import { startStockRollBackEventService } from "./handler/handleStockRollBackEvent";
import logger from "./utils/logger";

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

/* Subscribe to StockUpdated event, only for listening */
async function startService() {
  await subscribeEvent(
    "inventory_service",
    "stock_updated",
    "direct",
    async (eventType: string, data: any) => {
      logger.info(`Received event: ${eventType}`, data);
    }
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

export { app };
