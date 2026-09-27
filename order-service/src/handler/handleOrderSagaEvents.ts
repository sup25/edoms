import { EventType } from "@edoms/shared-events";
import Order from "../model/order.model";
import type { OrderStatus } from "../model/order.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

/**
 * The intermediate saga transitions.
 *
 *   pending  --inventory.order.reserved-->  reserved
 *   reserved --payment.succeeded--------->  paid
 *
 * Before Phase 5 an order went straight from pending to confirmed, because the
 * system had no idea it was sitting between the two waiting for a human. These
 * states are what let the timeout worker tell "waiting on inventory" apart
 * from "waiting on payment", and report either honestly.
 */

/** Which states a transition is allowed to move on from. */
const ALLOWED_FROM: Record<string, OrderStatus[]> = {
  reserved: ["pending"],
  paid: ["reserved", "pending"], // pending too: the reserved event may be late
};

async function transition(
  orderId: number,
  to: OrderStatus,
  reason: string
): Promise<void> {
  const order = await Order.findByPk(orderId);
  if (!order) {
    logger.error(`Order ${orderId} not found (${reason})`);
    return;
  }

  const from = ALLOWED_FROM[to] ?? [];
  if (!from.includes(order.status)) {
    // Idempotent by state: a redelivery, or an event that lost a race with a
    // terminal one, is ignored rather than dragging the order backwards.
    logger.warn(
      `Order ${orderId} is '${order.status}', not moving to '${to}' (${reason})`
    );
    return;
  }

  await order.update({ status: to });
  logger.info(`Order ${orderId}: ${order.status} -> ${to} (${reason})`);
}

export async function handleOrderReserved(event: {
  orderId: number;
}): Promise<void> {
  if (!event?.orderId) {
    logger.error("order.reserved without an orderId", event);
    return;
  }
  await transition(event.orderId, "reserved", "stock reserved");
}

export async function handlePaymentSucceeded(event: {
  orderId: number | string;
}): Promise<void> {
  const orderId = Number(event?.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    logger.error(`payment.succeeded with an invalid orderId: ${event?.orderId}`);
    return;
  }
  await transition(orderId, "paid", "payment succeeded");
}

export async function startOrderSagaEventService() {
  await subscribeEvent<{ orderId: number }>(
    EventType.ORDER_RESERVED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.ORDER_RESERVED}`, {
        correlationId: meta.correlationId,
      });
      await handleOrderReserved(payload);
    },
    { queue: "order-service.order-reserved" }
  );

  await subscribeEvent<{ orderId: number | string }>(
    EventType.PAYMENT_SUCCEEDED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.PAYMENT_SUCCEEDED}`, {
        correlationId: meta.correlationId,
      });
      await handlePaymentSucceeded(payload);
    },
    { queue: "order-service.payment-succeeded" }
  );

  logger.info("Order saga service started");
}
