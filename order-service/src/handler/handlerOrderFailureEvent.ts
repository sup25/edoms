import Order from "../model/order.model";
import { EventType } from "@edoms/shared-events";
import { IN_FLIGHT_STATUSES } from "../model/order.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

interface OrderConfirmedEvent {
  orderId: number;
  confirmedAt: string;
}

export async function handleOrderFailureEvent(
  event: OrderConfirmedEvent
): Promise<void> {
  try {
    {
      logger.info("Processing order event:", event);
      const { orderId, confirmedAt } = event;
      logger.info(
        `Processing order_failure event for orderId: ${orderId}, confirmed at: ${confirmedAt}`
      );

      const order = await Order.findByPk(orderId);
      if (!order) {
        logger.error(`Order with ID ${orderId} not found`);
        return;
      }

      // A failure can arrive while the order is pending, reserved or paid.
      if (!IN_FLIGHT_STATUSES.includes(order.status)) {
        logger.warn(`Order ${orderId} is '${order.status}', not failing again`);
        return;
      }

      await order.update({ status: "failed" });
      logger.info(`Order with ID ${orderId} status updated to 'failed'`);
    }
  } catch (error) {
    logger.error("Error handling order_failed event:", error);
    throw error;
  }
}

export async function startOrderFailureEventService() {
  await subscribeEvent(
    EventType.RESERVATION_RELEASED,
    async (payload: any, meta) => {
      logger.info(`Received ${EventType.RESERVATION_RELEASED}`, {
        correlationId: meta.correlationId,
      });
      await handleOrderFailureEvent(payload);
    },
    { queue: "order-service.order-failed" }
  );

  logger.info("Order failure service started");
}
