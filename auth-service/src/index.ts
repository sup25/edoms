import User from "./model";
import router from "./routes";
import connect from "./config/db";
import express from "express";
import {
  correlationMiddleware,
  healthHandler,
  initMetrics,
  metricsHandler,
  readyHandler,
  requestLogger,
} from "@edoms/shared-observability";
import { dependencies } from "./observability";
import logger from "./utils/logger";

(async () => {
  try {
    await connect.authenticate();
    logger.info("Connection successful");
    await User.sync({ force: false });
    logger.info("Users table synced");
  } catch (error) {
    logger.error("Startup failed", error);
  }
})();

// Registered before anything can record to it.
initMetrics("auth-service");

const app = express();

/*
 * Correlation first: anything mounted above it logs without a correlationId,
 * and an inbound x-correlation-id has to be honoured before a handler runs.
 */
app.use(correlationMiddleware());
app.use(requestLogger({ logger }));
app.use(express.json());

/* Probes and metrics sit outside /api/v1 - they are for operators, not clients. */
app.get("/health", healthHandler("auth-service"));
app.get("/ready", readyHandler("auth-service", dependencies));
app.get("/metrics", metricsHandler());

app.use("/api/v1", router);

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

export { app };
