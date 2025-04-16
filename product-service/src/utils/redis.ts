import Redis from "ioredis";
import logger from "./logger";

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT) || 6379,
  retryStrategy: (times) => {
    logger.error(`❌ Redis connection failed. Retry attempt: ${times}`);
    if (times >= 5) {
      console.error("❌ Max retry attempts reached. Exiting...");
      process.exit(1); // Exit the process if Redis is unreachable after retries
    }
    return Math.min(times * 100, 3000);
  },
});

redis.on("connect", () => {
  logger.info("✅ Connected to Redis!");
});

redis.on("error", (err) => {
  logger.error("❌ Redis Error:", err);
});

export default redis;
