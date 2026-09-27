import { QueryTypes } from "sequelize";
import sequelize from "../config/db";
import OrderReservation from "../model/orderReservation.model";
import { EventType } from "@edoms/shared-events";
import { publishToOutbox } from "../rabbitmq/outbox";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { processOnce } from "../utils/idempotency";
import type { EventMeta } from "../rabbitmq/subscriber";
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
  event: PaymentSuccessEvent,
  meta?: EventMeta
): Promise<void> {
  const orderId = Number(event?.orderId);
  const correlationId = meta?.correlationId;
  const causationId = meta?.causationId;
  if (!Number.isInteger(orderId) || orderId <= 0) {
    logger.error(`payment_success event with invalid orderId: ${event?.orderId}`);
    return;
  }

  let confirmed = 0;

  await processOnce(CONSUMER, EventType.PAYMENT_SUCCEEDED, meta, async (transaction) => {
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
      return;
    }

    // Same transaction as the status change.
    await publishToOutbox(
      EventType.RESERVATION_CONFIRMED,
      { orderId, confirmedAt: new Date().toISOString() },
      transaction,
      { correlationId, causationId }
    );
  });

  if (confirmed > 0) {
    logger.info(`Confirmed ${confirmed} reservation(s) for order ${orderId}`);
  }
}
export async function startPaymentSuccessEventService() {
  await subscribeEvent(
    EventType.PAYMENT_SUCCEEDED,
    async (payload: any, meta) => {
      logger.info(`Received ${EventType.PAYMENT_SUCCEEDED}`, {
        correlationId: meta.correlationId,
      });
      await handlePaymentSuccessEvent(payload, meta);
    },
    { queue: "inventory-service.payment-success" }
  );

  logger.info("service started for payment success event");
}
