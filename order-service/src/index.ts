import sequelize from "./config/db";
import express from "express";
import Order from "./model/order.model";
import router from "./routes";
import { startOrderConfirmEventService } from "./handler/handleOrderConfirmedEvent";
import { startOrderFailureEventService } from "./handler/handlerOrderFailureEvent";
import logger from "./utils/logger";

const app = express();
(async () => {
  try {
    await sequelize.authenticate();
    logger.info("Connection successful");
    await Order.sync({ alter: true });
    logger.info("Order table synced");
  } catch (error) {
    logger.error("Connection failed:", error);
  }
})();

startOrderConfirmEventService();
startOrderFailureEventService();

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

export { app };
