import axios from "axios";
import redis from "../utils/redis";
import { subscribeToEvent } from "../rabbitmq/subscriber";

const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL;

// Function to subscribe to the stock_decrement event
export const subscribeToStockDecrementEvent = () => {
  subscribeToEvent(
    "stock_decrement",
    async (eventData) => {
      const { productId } = eventData;

      try {
        // Fetch the updated stock from the Inventory Service
        const stockResponse = await axios.get(
          `${INVENTORY_SERVICE_URL}/stock/${productId}`
        );
        const updatedStock = stockResponse.data.data?.toString() || "0"; // Convert to string for Redis

        // Update Redis cache with the new stock value
        await redis.setex(`stock:${productId}`, 300, updatedStock);

        console.log(
          `Stock updated for product ${productId} in Redis to: ${updatedStock}`
        );
      } catch (error) {
        console.error(`Error fetching stock for product ${productId}:`, error);
      }
    },
    "inventory_exchange"
  );
};
