import axios from "axios";
import redis from "../utils/redis";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { INVENTORY_SERVICE_URL } from "../config/apiEndpoints";
import logger from "../utils/logger";

/**
 * Subscribes to the `stock_decrement` event to update the Redis cache with the latest stock value for a product.
 *
 * @remarks
 * - Expects messages in the format: `{ event: "stock_decrement", data: { productId: number } }`.
 */
export async function handleStockDecrement(eventType: string, event: any) {
  if (eventType === "Stock Decrement") {
    const { productId } = event;

    if (eventType !== "Stock Decrement") {
      console.warn(`Unexpected event type: ${eventType}`);
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
      const updatedStock = stockResponse.data.data?.toString() || "0"; // Convert to string for Redis

      // Update Redis cache with the new stock value (TTL: 300 seconds)
      await redis.setex(`stock:${productId}`, 300, updatedStock);

      logger.info(
        `Stock updated for product ${productId} in Redis to: ${updatedStock}`
      );
    } catch (error) {
      console.error(
        `Failed to update stock for product ${productId} in Redis:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

export async function startStockDecrementEventService() {
  await subscribeEvent(
    "inventory_service",
    "stock_decrement",
    "direct",
    async (eventType: string, data: any) => {
      await handleStockDecrement(eventType, data);
    }
  );

  logger.info("service started for stock decrement event");
}
