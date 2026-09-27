import express from "express";
import connectdb from "./config/db";
import Payment from "./model/payment.model";
import router from "./routes";
import logger from "./utils/logger";
import { closeBroker } from "./rabbitmq/connection";

const app = express();
(async () => {
  try {
    await connectdb.authenticate();
    logger.info("Connection successful");
    await Payment.sync({ alter: true });
    logger.info("Payment table synced");
  } catch (error) {
    logger.error("Error:", error);
    process.exit(1);
  }
})();
app.use(express.json());
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
