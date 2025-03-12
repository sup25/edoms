import sequelize from "./config/db";
import express from "express";
import Order from "./model/order.model";
import router from "./routes";

const app = express();
(async () => {
  try {
    await sequelize.authenticate();
    console.log("Connection successful");
    await Order.sync({ alter: true });
    console.log("Order table synced");
  } catch (error) {
    console.error("Connection failed:", error);
  }
})();

app.use(express.json());
app.use("/api/v1", router);
const PORT = process.env.PORT || 5003;

if (process.env.NODE_ENV !== "test") {
  try {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
  }
}
