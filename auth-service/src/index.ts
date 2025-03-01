import sequelize from "./config/db";

(async () => {
  try {
    await sequelize.authenticate();
    console.log("Connection successful");
  } catch (error) {
    console.error("Connection failed:", error);
  }
})();
