import { EventType } from "@edoms/shared-events";
import connectdb from "../config/db";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { publishToOutbox } from "../rabbitmq/outbox";
import { processPaymentAndStoreDetailsService } from "../service";
import Payment from "../model/payment.model";
import { TPaymentResponse } from "../types";
import logger from "../utils/logger";

interface OrderReservedEvent {
  orderId: number;
  userId?: number;
  items: {
    productId: number;
    quantity: number;
    price: number | string;
    name?: string;
  }[];
  totalAmount?: number | string;
  reservedAt?: string;
}

interface Meta {
  correlationId: string;
  causationId?: string;
}

/**
 * Charges an order as soon as its stock is reserved.
 *
 * This is the change that makes EDOMS event-driven.
 *
 * Until now the saga stopped dead after reservation and waited for the client
 * to send a second HTTP request to /create-payment. Machine-to-machine hops
 * took ~10ms; the gap in the middle took as long as a human did. The system
 * did not know an order was waiting to be paid, which is also why nothing
 * could time one out.
 *
 * The HTTP endpoint still exists for manual retries and operator use. Both
 * paths converge on the same service, which is idempotent per order: Stripe is
 * called with `idempotencyKey: payment-<orderId>` and the payment row has a
 * uniqueness check, so an order cannot be charged twice.
 */
export async function handleOrderReservedEvent(
  event: OrderReservedEvent,
  meta?: Meta
): Promise<void> {
  const orderId = Number(event?.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    logger.error(`order.reserved with an invalid orderId: ${event?.orderId}`);
    return;
  }

  const items = event.items ?? [];
  if (items.length === 0) {
    logger.error(`order.reserved for order ${orderId} has no items`);
    return;
  }

  const orderIdStr = String(orderId);

  // Skip an order that already has a payment. The reservation event can be
  // redelivered, and the HTTP endpoint may have been used in the meantime.
  const existing = await Payment.findOne({ where: { orderId: orderIdStr } });
  if (existing) {
    logger.info(
      `Order ${orderId} already has payment ${existing.paymentId} ` +
        `(${existing.status}); not charging again`
    );
    return;
  }

  /*
   * Prices ride on the event, so there is no callback to order-service here.
   * processPaymentAndStoreDetailsService takes productId and price as strings
   * (it parseFloats the price), matching what the HTTP path already sends.
   */
  const chargeItems = items.map((item) => ({
    productId: String(item.productId),
    quantity: item.quantity,
    price: String(item.price),
  }));

  logger.info(`Charging order ${orderId} (${chargeItems.length} item(s))`, {
    correlationId: meta?.correlationId,
  });

  let result: TPaymentResponse;
  try {
    result = await processPaymentAndStoreDetailsService(
      orderIdStr,
      String(event.userId ?? ""),
      chargeItems
    );
  } catch (error: unknown) {
    /*
     * A thrown error is infrastructure (Stripe unreachable, DB down), not a
     * declined card. Rethrow so the subscriber retries and eventually
     * dead-letters, rather than failing the order over a transient fault.
     */
    logger.error(`Charging order ${orderId} threw`, error);
    throw error;
  }

  const eventType =
    result.status === "success"
      ? EventType.PAYMENT_SUCCEEDED
      : EventType.PAYMENT_FAILED;

  await connectdb.transaction(async (transaction) =>
    publishToOutbox(
      eventType,
      result.status === "success"
        ? {
            orderId: orderIdStr,
            userId: event.userId,
            items: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
            })),
          }
        : { orderId: orderIdStr, reason: "payment_declined" },
      transaction,
      { correlationId: meta?.correlationId, causationId: meta?.causationId }
    )
  );

  logger.info(`Order ${orderId} payment ${result.status}`, {
    correlationId: meta?.correlationId,
  });
}

export async function startOrderReservedEventService() {
  await subscribeEvent<OrderReservedEvent>(
    EventType.ORDER_RESERVED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.ORDER_RESERVED}`, {
        correlationId: meta.correlationId,
      });
      await handleOrderReservedEvent(payload, meta);
    },
    { queue: "payment-service.order-reserved" }
  );

  logger.info("Automatic payment service started");
}
