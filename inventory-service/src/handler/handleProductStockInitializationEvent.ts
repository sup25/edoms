import Stock from "../model/stock.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

// Define the expected structure of the incoming event
interface ProductEvent {
  id: number;
  stock?: number;
}

/**
 * Handles the `product created` event to initialize stock for a new product.
 *
 * @param eventType - The type of event (should be "product created").
 * @param event - The event data containing the product id and optional stock.
 */
export async function handleProductStockInitialization(
  eventType: string,
  event: ProductEvent
) {
  try {
    logger.info("Processing event:", event);

    if (eventType === "product created") {
      // Validate required field: id
      if (typeof event.id !== "number") {
        throw new Error("Invalid event data: 'id' must be a number");
      }

      const productId = event.id;
      const stockValue = typeof event.stock === "number" ? event.stock : 0; // Default to 0 if stock isn't provided or isn't a number

      // Check if stock entry already exists
      const existingStock = await Stock.findOne({
        where: { productId },
      });

      if (!existingStock) {
        // Create new stock entry with required fields
        await Stock.create({
          productId,
          stock: stockValue,
          low_stock_threshold: 5,
        });

        logger.info(
          `Stock initialized for product ${productId} with ${stockValue} units.`
        );
      } else {
        logger.info(`Stock already exists for product ${productId}`);
      }
    } else {
      logger.error(`Unexpected event type: ${eventType}`);
    }
  } catch (error) {
    logger.error("Error handling product event:", error);
  }
}

/**
 * Starts the service to listen for `product created` events and process them.
 */
export async function startProductStockInitializationEventService() {
  await subscribeEvent(
    "product_service",
    "product_created",
    "direct",
    async (eventType: string, data: ProductEvent) => {
      logger.info(`Received event: ${eventType}`, data);
      await handleProductStockInitialization(eventType, data);
    }
  );

  logger.info("Service started for product stock initialization event");
}
