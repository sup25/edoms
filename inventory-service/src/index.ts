import express from "express";
import { subscribeToProductEvents } from "./rabbitmq/subscriber";
import connectdb from "./config/db";
import Stock from "./model/inventory.model";
import router from "./routes";

const app = express();

(async () => {
  try {
    await connectdb.authenticate();
    console.log("Connection successful");
    await Stock.sync({ alter: true });
    console.log("Stocks table synced");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();
async function startService() {
  await subscribeToProductEvents();
  console.log("Inventory service started");
}

startService();

app.use(express.json());
app.use("/api/v1", router);
const PORT = process.env.PORT || 5002;

if (process.env.NODE_ENV !== "test") {
  try {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
  }
}

export { app };
