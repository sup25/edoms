import Redis from "ioredis";
import logger from "./logger";

/**
 * Shared Redis client.
 *
 * The controller previously did a bare `new Redis()` at module scope: no host
 * or port from the environment, and no `error` listener, so ioredis emitted
 * "Unhandled error event: ECONNREFUSED" on a loop whenever Redis was down
 * (defect #12). It is configured and supervised here instead.
 */
const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  // Fail a command rather than queueing it forever when Redis is unreachable;
  // the cache is an optimisation, not a source of truth.
  maxRetriesPerRequest: 2,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5_000);
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
