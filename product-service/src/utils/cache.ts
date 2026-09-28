import redis from "./redis";
import logger from "./logger";

/**
 * Runs a cache operation whose failure must not fail the caller.
 *
 * The cache is an optimisation, not a source of truth. Inside an event
 * handler that distinction is load-bearing: the handler throwing is how it
 * asks the subscriber to retry and eventually dead-letter, so an `await
 * redis.setex(...)` that rejects during a Redis outage would dead-letter a
 * domain event whose actual work had already succeeded. The stock would be
 * correct in the database and the event would be in a DLQ.
 *
 * A stale cache entry is the far smaller problem, and the TTL already bounds
 * it. So: log and carry on.
 *
 * Use this for cache WRITES and invalidations. A cache READ should fall back
 * to its source instead, which the callers that read already do.
 */
export async function cacheWrite(
  description: string,
  operation: () => Promise<unknown>
): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch (error) {
    logger.warn(`Cache write failed (${description}), continuing`, {
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export { redis };
