import { QueryTypes } from "sequelize";
import sequelize from "../config/db";
import OrderReservation from "../model/orderReservation.model";
import { publishEvent } from "../rabbitmq/publisher";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { processOnce, EventMeta } from "../utils/idempotency";
import logger from "../utils/logger";

interface PaymentSuccessEvent {
  orderId: number | string;
}

const CONSUMER = "inventory.payment-success";

/**
 * Confirms the reservations held by an order once its payment succeeds.
 *
 * Phase 3: only `pending` reservations are confirmed, and the whole thing runs
 * through processOnce, so a redelivered payment_success cannot re-confirm a
 * reservation that was since cancelled by a failure.
 */
export async function handlePaymentSuccessEvent(
  eventType: string,
  event: PaymentSuccessEvent,
  meta?: EventMeta
): Promise<void> {
  if (eventType !== "payment_success") {
    logger.info(`Unhandled event type: ${eventType}`);
    return;
  }

  const orderId = Number(event?.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    logger.error(`payment_success event with invalid orderId: ${event?.orderId}`);
    return;
  }

  let confirmed = 0;

  await processOnce(CONSUMER, eventType, meta, async (transaction) => {
    const reservations = await OrderReservation.findAll({
      where: { orderId },
      transaction,
    });

    if (!reservations.length) {
      logger.error(`No OrderReservations found for orderId: ${orderId}`);
      return;
    }

    // Only pending rows move to confirmed. A reservation already cancelled by
    // a payment failure must not be resurrected.
    const updated = await sequelize.query<{ id: number }>(
      `UPDATE "order_reservations"
          SET status = 'confirmed', updated_at = NOW()
        WHERE order_id = :orderId
          AND status = 'pending'
    RETURNING id`,
      { replacements: { orderId }, type: QueryTypes.SELECT, transaction }
    );

    confirmed = updated.length;

    if (confirmed === 0) {
      logger.warn(
        `No pending reservations to confirm for order ${orderId} ` +
          `(already confirmed, or cancelled by a prior failure)`
      );
    }
  });

  if (confirmed > 0) {
    logger.info(`Confirmed ${confirmed} reservation(s) for order ${orderId}`);
    await publishEvent(
      "inventory_service",
      "order_confirmed",
      "order confirmed",
      { orderId, confirmedAt: new Date().toISOString() }
    );
  }
}

export async function startPaymentSuccessEventService() {
  await subscribeEvent(
    "payment_service",
    "payment_success",
    "direct",
    async (eventType: string, data: any, meta) => {
      logger.info(`Received event: ${eventType}`, data);
      await handlePaymentSuccessEvent(eventType, data, meta);
    },
    { queue: "inventory-service.payment-success" }
  );

  logger.info("service started for payment success event");
}
