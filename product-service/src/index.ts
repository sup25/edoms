import connectdb from "./config/db";
import express from "express";
import Product from "./model/product.model";
import router from "./routes";
import { subscribeToEvent } from "./rabbitmq/subscriber";

const app = express();
(async () => {
  try {
    await connectdb.authenticate();
    console.log("Connection successful");
    await Product.sync({ alter: true });
    console.log("Product table synced");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
})();

async function startService() {
  await subscribeToEvent("StockUpdated", (data) => {});
}

startService();

app.use(express.json());
app.use("/api/v1", router);
const PORT = process.env.PORT || 5001;

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
