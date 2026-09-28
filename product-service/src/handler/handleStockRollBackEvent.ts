import axios from "axios";
import { cacheWrite } from "../utils/cache";
import redis from "../utils/redis";
import { EventType } from "@edoms/shared-events";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { INVENTORY_SERVICE_URL } from "../config/apiEndpoints";
import logger from "../utils/logger";

/**
 * Subscribes to the `order_failed` event to rollback the Redis cache with the latest stock value for a product.
 *
 */
export async function handleStockRollBack(event: any) {
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
      const rollbackStock = stockResponse.data.data?.toString() || "0"; // Convert to string for Redis

      // Non-fatal, for the same reason as the decrement handler: the
      // rollback itself already happened in inventory.
      await cacheWrite(`stock:${productId}`, () =>
        redis.setex(`stock:${productId}`, 300, rollbackStock)
      );

      logger.info(
        `Stock rollbacked for product ${productId} in Redis to: ${rollbackStock}`
      );
    } catch (error) {
      logger.error(
        `Failed to rollback stock for product ${productId} in Redis:`,
        error instanceof Error ? error.message : String(error)
      );
      // Rethrow so the subscriber can retry and eventually dead-letter.
      throw error;
    }
  }
}

export async function startStockRollBackEventService() {
  await subscribeEvent(
    EventType.RESERVATION_RELEASED,
    async (payload: any, meta) => {
      logger.info(`Received ${EventType.RESERVATION_RELEASED}`, {
        correlationId: meta.correlationId,
      });
      await handleStockRollBack(payload);
    },
    { queue: "product-service.reservation-released" }
  );
}
