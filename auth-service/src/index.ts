import User from "./auth/model";
import router from "./auth/route";
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
app.use("/api/v1/users", router);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
