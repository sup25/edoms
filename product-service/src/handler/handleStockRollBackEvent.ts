import axios from "axios";
import redis from "../utils/redis";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { INVENTORY_SERVICE_URL } from "../config/apiEndpoints";
import logger from "../utils/logger";

/**
 * Subscribes to the `order_failed` event to rollback the Redis cache with the latest stock value for a product.
 *
 */
export async function handleStockRollBack(eventType: string, event: any) {
  if (eventType === "order failed") {
    const { productId } = event;

    if (eventType !== "order failed") {
      logger.warn(`Unexpected event type: ${eventType}`);
      return;
    }

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

      // Update Redis cache with the new stock value (TTL: 300 seconds)
      await redis.setex(`stock:${productId}`, 300, rollbackStock);

      logger.info(
        `Stock rollbacked for product ${productId} in Redis to: ${rollbackStock}`
      );
    } catch (error) {
      logger.error(
        `Failed to rollback stock for product ${productId} in Redis:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export async function startStockRollBackEventService() {
  await subscribeEvent(
    "inventory_service",
    "order_failed",
    "direct",
    async (eventType: string, data: any) => {
      await handleStockRollBack(eventType, data);
    }
  );
}
