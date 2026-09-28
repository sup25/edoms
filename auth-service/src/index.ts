// Tracing first: it patches modules as they are required.
import "./tracing";
// Then config: a misconfigured service should fail here, not three
// layers down when something reads an env var that was never set.
import "./config/env";
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
  stopTracing,
} from "@edoms/shared-observability";
import { dependencies } from "./observability";
import helmet from "helmet";
import { apiLimiter } from "./middleware/security";
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
/*
 * Security headers before anything else answers. helmet removes the
 * `X-Powered-By: Express` giveaway and sets the usual hardening headers; the
 * default CSP is off because these services return JSON, not documents.
 */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(apiLimiter);

app.use(correlationMiddleware());
app.use(requestLogger({ logger }));
app.use(express.json({ limit: "100kb" }));

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

/*
 * Graceful shutdown. Phase 1 gave the four broker services one; auth-service
 * was skipped because it has no in-flight messages to drain. It still holds a
 * DB pool, and now a span exporter with spans that have not been flushed.
 */
async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  try {
    await connect.close();
    await stopTracing();
  } catch (error) {
    logger.error("Error during shutdown", error);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
