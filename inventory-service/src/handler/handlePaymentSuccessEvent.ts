import OrderReservation from "../model/orderReservation.model";
import { publishEvent } from "../rabbitmq/publisher";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

interface PaymentSuccessEvent {
  orderId: number;
}

export async function handlePaymentSuccessEvent(
  eventType: string,
  event: PaymentSuccessEvent
): Promise<void> {
  try {
    if (eventType === "payment_success") {
      const { orderId } = event;

      // Find all reservations under the given orderId
      const reservations = await OrderReservation.findAll({
        where: { orderId },
      });

      if (!reservations.length) {
        logger.error(`No OrderReservations found for orderId: ${orderId}`);
        return;
      }

      // Update all products' status to 'confirmed' in the order
      await OrderReservation.update(
        { status: "confirmed" },
        { where: { orderId } }
      );

      logger.info(
        `OrderReservation confirmed for all products in orderId: ${orderId}`
      );
      await publishEvent(
        "invetory_service",
        "order_confirmed",
        "order confirmed",
        {
          orderId,
          confirmedAt: new Date().toISOString(),
        }
      );
    } else {
      logger.info(`Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    logger.error("Error handling payment success event:", error);
  }
}

export async function startPaymentSuccessEventService() {
  await subscribeEvent(
    "payment_service",
    "payment_success",
    "direct",
    async (eventType: string, data: any) => {
      logger.info(`Received event: ${eventType}`, data);
      await handlePaymentSuccessEvent(eventType, data);
    }
  );

  logger.info("service started for payment success event");
}
