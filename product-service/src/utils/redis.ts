import Redis from "ioredis";
import logger from "./logger";

/**
 * Shared Redis client.
 *
 * This is the twin of the bug fixed in order-service in Phase 2 (defect #12),
 * which was never applied here. Two things were wrong:
 *
 * 1. The retry strategy called `process.exit(1)` after five attempts. A cache
 *    being unreachable would take the whole service down - and, because the
 *    client is constructed at module scope, it also killed `jest` the moment a
 *    test imported anything that transitively required this file. That is why
 *    product-service's suite could not run on a machine without Redis.
 *
 * 2. No `maxRetriesPerRequest`, so commands queued forever instead of failing,
 *    turning a Redis outage into a hang rather than an error.
 *
 * The cache is an optimisation, not a source of truth. Losing it should make
 * this service slower, never dead.
 */
const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  // Fail a command rather than queueing it forever when Redis is unreachable.
  maxRetriesPerRequest: 2,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5_000);
    // Log the first attempt and then every tenth, so an outage does not
    // produce a line every few hundred milliseconds for as long as it lasts.
    if (times === 1 || times % 10 === 0) {
      logger.warn(`Redis unreachable, retry ${times} in ${delay}ms`);
    }
    return delay;
  },
});

redis.on("error", (error: Error) => {
  // Attached so ioredis does not treat this as an unhandled error event.
  logger.error("Redis error:", error.message);
});

redis.on("connect", () => logger.info("Redis connected"));

export default redis;
