import { QueryTypes } from "sequelize";
import sequelize from "../config/db";
import OrderReservation from "../model/orderReservation.model";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { publishEvent } from "../rabbitmq/publisher";
import { processOnce, EventMeta } from "../utils/idempotency";
import logger from "../utils/logger";

interface PaymentFailureEvent {
  orderId: number | string;
}

const CONSUMER = "inventory.payment-failure";

/**
 * Releases stock held by an order whose payment failed.
 *
 * Phase 3 changes:
 * - the restore is an atomic `stock = stock + :qty` UPDATE rather than a
 *   read-then-write, so concurrent rollbacks cannot lose an update
 * - each reservation is only released if it is still `pending`. Without that
 *   guard a duplicate payment_failure would credit the stock twice and invent
 *   inventory that does not exist (defect #7)
 * - wrapped in processOnce as a second layer of protection
 */
export async function handlePaymentFailureEvent(
  eventType: string,
  event: PaymentFailureEvent,
  meta?: EventMeta
): Promise<void> {
  if (eventType !== "payment_failure") {
    logger.info(`Unhandled event type: ${eventType}`);
    return;
  }

  const orderId = Number(event?.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    logger.error(`payment_failure event with invalid orderId: ${event?.orderId}`);
    return;
  }

  const released: { productId: number; quantity: number }[] = [];

  await processOnce(CONSUMER, eventType, meta, async (transaction) => {
    released.length = 0;

    const reservations = await OrderReservation.findAll({
      where: { orderId },
      transaction,
    });

    if (!reservations.length) {
      logger.error(`No OrderReservations found for orderId: ${orderId}`);
      return;
    }

    for (const reservation of reservations) {
      const { id, productId, reservedQuantity, status } = reservation;

      /*
       * Only a reservation that is still pending may be released. Flipping the
       * status and checking the previous value in one statement means two
       * concurrent rollbacks cannot both win: the second sees zero rows.
       */
      const claimed = await sequelize.query<{ id: number }>(
        `UPDATE "order_reservations"
            SET status = 'canceled', updated_at = NOW()
          WHERE id = :id
            AND status = 'pending'
      RETURNING id`,
        { replacements: { id }, type: QueryTypes.SELECT, transaction }
      );

      if (claimed.length === 0) {
        logger.warn(
          `Reservation ${id} for order ${orderId} is already '${status}', ` +
            `not releasing stock again`
        );
        continue;
      }

      await sequelize.query(
        `UPDATE "Stocks"
            SET stock = stock + :quantity
          WHERE "productId" = :productId`,
        {
          replacements: { quantity: reservedQuantity, productId },
          type: QueryTypes.UPDATE,
          transaction,
        }
      );

      released.push({ productId, quantity: reservedQuantity });
      logger.info(
        `Released ${reservedQuantity} unit(s) of product ${productId} for order ${orderId}`
      );
    }
  });

  // Published after commit so consumers never see an event for work that was
  // rolled back.
  for (const item of released) {
    await publishEvent("inventory_service", "order_failed", "order failed", {
      orderId,
      productId: item.productId,
      rolledBackQuantity: item.quantity,
      failedAt: new Date().toISOString(),
    });
  }

  if (released.length === 0) {
    logger.info(
      `Payment failure for order ${orderId} released nothing (already handled)`
    );
  }
}

export async function startPaymentFailureEventService() {
  await subscribeEvent(
    "payment_service",
    "payment_failure",
    "direct",
    async (eventType: string, data: any, meta) => {
      logger.info(`Received event: ${eventType}`, data);
      await handlePaymentFailureEvent(eventType, data, meta);
    },
    { queue: "inventory-service.payment-failure" }
  );

  logger.info("Inventory service started for payment failure event");
}
