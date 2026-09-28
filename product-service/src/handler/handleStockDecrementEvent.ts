import axios from "axios";
import { cacheWrite } from "../utils/cache";
import redis from "../utils/redis";
import { EventType } from "@edoms/shared-events";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { INVENTORY_SERVICE_URL } from "../config/apiEndpoints";
import logger from "../utils/logger";

/**
 * Subscribes to the `stock_decrement` event to update the Redis cache with the latest stock value for a product.
 *
 * @remarks
 * - Expects messages in the format: `{ event: "stock_decrement", data: { productId: number } }`.
 */
export async function handleStockDecrement(event: any) {
  {
    const { productId } = event;


    try {
      // Validate productId
      if (typeof productId !== "number" || productId <= 0) {
        throw new Error(`Invalid productId: ${productId}`);
      }

      // Fetch the updated stock from the Inventory Service
      const stockResponse = await axios.get(
        `${INVENTORY_SERVICE_URL}/stock/${productId}`
      );
      const updatedStock = stockResponse.data.data?.toString() || "0"; // Convert to string for Redis

      // Non-fatal: inventory is already correct, so a Redis outage should
      // leave the cache stale (the TTL bounds that) rather than dead-letter an
      // event whose real work is done. The axios call above still throws.
      await cacheWrite(`stock:${productId}`, () =>
        redis.setex(`stock:${productId}`, 300, updatedStock)
      );

      logger.info(
        `Stock updated for product ${productId} in Redis to: ${updatedStock}`
      );
    } catch (error) {
      logger.error(
        `Failed to update stock for product ${productId} in Redis:`,
        error instanceof Error ? error.message : String(error)
      );
      // Rethrow so the subscriber can retry and eventually dead-letter.
      throw error;
    }
  }
}

export async function startStockDecrementEventService() {
  await subscribeEvent(
    EventType.STOCK_RESERVED,
    async (payload: any, meta) => {
      logger.info(`Received ${EventType.STOCK_RESERVED}`, {
        correlationId: meta.correlationId,
      });
      await handleStockDecrement(payload);
    },
    { queue: "product-service.stock-reserved" }
  );

  logger.info("service started for stock decrement event");
}
