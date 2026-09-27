import Order from "../model/order.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

interface ReservationFailedEvent {
  orderId: number;
  productId?: number;
  requestedQuantity?: number;
  reason?: string;
  failedAt?: string;
}

/**
 * Fails an order that inventory could not reserve stock for.
 *
 * Before Phase 3 inventory skipped a short item with `continue` and published
 * nothing, so the order sat at `pending` forever with no indication anything
 * had gone wrong (defect #6). Inventory now publishes `reservation_failed`
 * and this handler closes the loop.
 */
export async function handleReservationFailedEvent(
  eventType: string,
  event: ReservationFailedEvent
): Promise<void> {
  if (eventType !== "reservation failed") {
    logger.error("Invalid event type:", eventType);
    return;
  }

  const { orderId, productId, requestedQuantity, reason } = event;

  if (!orderId) {
    logger.error("reservation_failed event without orderId", event);
    return;
  }

  const order = await Order.findByPk(orderId);
  if (!order) {
    logger.error(`Order with ID ${orderId} not found`);
    return;
  }

  // Idempotent by state: a redelivery finds the order already failed.
  if (order.status !== "pending") {
    logger.warn(
      `Order ${orderId} is '${order.status}', not marking failed again`
    );
    return;
  }

  await order.update({ status: "failed" });
  logger.info(
    `Order ${orderId} marked FAILED (${reason ?? "reservation_failed"}` +
      `${productId ? `, product ${productId} x${requestedQuantity}` : ""})`
  );
}

export async function startReservationFailedEventService() {
  await subscribeEvent(
    "inventory_service",
    "reservation_failed",
    "direct",
    async (eventType: string, data: any) => {
      logger.info(`Received event: ${eventType}`, data);
      await handleReservationFailedEvent(eventType, data);
    },
    { queue: "order-service.reservation-failed" }
  );

  logger.info("Reservation failure service started");
}
