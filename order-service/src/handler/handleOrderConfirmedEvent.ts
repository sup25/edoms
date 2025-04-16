import Order from "../model/order.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

interface OrderConfirmedEvent {
  orderId: number;
  confirmedAt: string;
}

export async function handleOrderConfirmedEvent(
  eventType: string,
  event: OrderConfirmedEvent
): Promise<void> {
  try {
    if (eventType === "order confirmed") {
      logger.info("Processing order event:", event);
      logger.info("Event type:", eventType);
      const { orderId, confirmedAt } = event;
      logger.info(
        `Processing order_confirmed event for orderId: ${orderId}, confirmed at: ${confirmedAt}`
      );

      const order = await Order.findByPk(orderId);
      if (!order) {
        logger.error(`Order with ID ${orderId} not found`);
        return;
      }

      if (order.status !== "pending") {
        logger.warn(
          `Order with ID ${orderId} is not in 'pending' state. Current status: ${order.status}`
        );
        return;
      }

      await order.update({ status: "confirmed" });
      logger.info(`Order with ID ${orderId} status updated to 'confirmed'`);
    } else {
      logger.error("Invalid event type:", eventType);
    }
  } catch (error) {
    logger.error("Error handling order_confirmed event:", error);
    throw error;
  }
}

export async function startOrderConfirmEventService() {
  await subscribeEvent(
    "invetory_service",
    "order_confirmed",
    "direct",
    async (eventType: string, data: any) => {
      logger.info(`Received event: ${eventType}`, data);
      await handleOrderConfirmedEvent(eventType, data);
    }
  );

  logger.info("Order confirmation service started");
}
