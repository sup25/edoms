import OrderReservation from "../model/orderReservation.model";
import Stock from "../model/stock.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { publishEvent } from "../rabbitmq/publisher";
import logger from "../utils/logger";

interface PaymentFailureEvent {
  orderId: number;
}

export async function handlePaymentFailureEvent(
  eventType: string,
  event: PaymentFailureEvent
): Promise<void> {
  try {
    if (eventType === "payment_failure") {
      const { orderId } = event;

      // Find all reservations for the given orderId
      const reservations = await OrderReservation.findAll({
        where: { orderId },
      });

      if (!reservations.length) {
        logger.error(`No OrderReservations found for orderId: ${orderId}`);
        return;
      }

      // Release stock and update reservation status
      for (const reservation of reservations) {
        const { productId, reservedQuantity } = reservation;

        // Find the stock entry for this product
        const stockItem = await Stock.findOne({
          where: { productId },
        });

        if (!stockItem) {
          logger.error(`No stock found for productId: ${productId}`);
          continue;
        }

        // Return the reserved quantity back to stock
        await Stock.update(
          {
            stock: stockItem.stock + reservedQuantity,
          },
          { where: { productId } }
        );

        // Update reservation status to 'canceled'
        await OrderReservation.update(
          { status: "canceled" },
          { where: { id: reservation.id } }
        );

        logger.info(
          `Stock released (${reservedQuantity} units) for productId: ${productId}, orderId: ${orderId}`
        );
        await publishEvent(
          "inventory_service",
          "order_failed",
          "order failed",
          {
            productId,
            rolledBackQuantity: reservedQuantity,
          }
        );
      }

      logger.info(`Payment failure processed for orderId: ${orderId}`);
    } else {
      logger.info(`Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    logger.error("Error handling payment failure event:", error);
  }
}

export async function startPaymentFailureEventService() {
  await subscribeEvent(
    "payment_service",
    "payment_failure",
    "direct",
    async (eventType: string, data: any) => {
      logger.info(`Received event: ${eventType}`, data);
      await handlePaymentFailureEvent(eventType, data);
    }
  );

  logger.info("Inventory service started for payment failure event");
}
