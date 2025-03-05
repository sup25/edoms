import User from "./model";
import router from "./route";
import connect from "./config/db";
import express from "express";

(async () => {
  try {
    await connect.authenticate();
    console.log("Connection successful");
    await User.sync({ force: false });
    console.log("Users table synced");
  } catch (error) {
    console.error("Error:", error);
  }
})();

const app = express();

app.use(express.json());
app.use("/api/v1", router);

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export { app };
