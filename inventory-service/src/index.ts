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

const app = express();

(async () => {
  try {
    await connectdb.authenticate();
    logger.info("Connection successful");

    await Stock.sync({ alter: true });
    logger.info("Stocks table synced");

    await OrderReservation.sync({ alter: true });
    logger.info("OrderReservation table synced");
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

app.use(express.json());
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

export { app };
