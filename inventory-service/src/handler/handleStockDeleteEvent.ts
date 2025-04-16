import Stock from "../model/stock.model";
import OrderReservation from "../model/orderReservation.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

export async function handleStockDelete(eventType: string, event: any) {
  try {
    if (eventType !== "product deleted") {
      logger.error("⚠️ Invalid event type received:", eventType);
      return;
    }

    const productId = event?.id;
    if (!productId) {
      logger.error("❌ Missing product ID in event data:", event);
      return;
    }

    logger.info(`🔄 Processing product deletion for ID: ${productId}`);

    // Attempt to delete stock
    const deletedStock = await Stock.destroy({ where: { productId } });
    if (deletedStock > 0) {
      logger.info(` Stock deleted successfully for Product ID: ${productId}`);
    } else {
      logger.error(`No stock found for Product ID: ${productId}`);
    }

    // Attempt to delete order reservations
    const deletedReservations = await OrderReservation.destroy({
      where: { productId },
    });
    if (deletedReservations > 0) {
      logger.info(
        ` Order Reservations deleted successfully for Product ID: ${productId}`
      );
    } else {
      logger.error(` No order reservations found for Product ID: ${productId}`);
    }
  } catch (error) {
    logger.error(" Error handling stock deletion event:", error);
  }
}

export async function startProductStockDeletionEventService() {
  try {
    await subscribeEvent(
      "product_service",
      "product_deleted",
      "direct",
      async (eventType: string, data: any) => {
        logger.info(` Received event: ${eventType}`, data);
        await handleStockDelete(eventType, data);
      }
    );

    logger.info("Service started for product delete event");
  } catch (error) {
    logger.error(" Failed to start product delete handler service:", error);
  }
}
