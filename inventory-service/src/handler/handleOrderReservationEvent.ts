import { QueryTypes } from "sequelize";
import sequelize from "../config/db";
import OrderReservation from "../model/orderReservation.model";
import { EventType } from "@edoms/shared-events";
import { publish } from "../rabbitmq/publisher";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { processOnce } from "../utils/idempotency";
import type { EventMeta } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

interface OrderItem {
  productId: number;
  quantity: number;
}

interface OrderCreatedEvent {
  orderId: number;
  userId?: number;
  items: OrderItem[];
}

const CONSUMER = "inventory.order-created";

/**
 * Reserves stock for a newly created order.
 *
 * Phase 3 changes:
 * - the decrement is a single conditional UPDATE, so two concurrent orders
 *   cannot both pass the stock check and oversell (defect #5)
 * - the whole order is reserved in ONE transaction: if any item cannot be
 *   satisfied, nothing is reserved (defect #6). Previously a short item was
 *   skipped with `continue`, leaving a half-reserved order stuck pending.
 * - insufficient stock now publishes `reservation_failed` instead of silently
 *   doing nothing, so the order can be failed rather than hanging forever
 * - wrapped in processOnce, so a redelivery does not decrement twice
 */
export async function handleOrderReservationEvent(
  event: OrderCreatedEvent,
  meta?: EventMeta
) {
  const { orderId, items } = event;
  const correlationId = meta?.correlationId;
  const causationId = meta?.causationId;

  if (!orderId || !Array.isArray(items) || items.length === 0) {
    logger.error(`Malformed order_created event for order ${orderId}`);
    return;
  }

  // Collected inside the transaction, acted on after it commits.
  let shortfall: { productId: number; requested: number } | null = null;
  let reserved: OrderItem[] = [];

  await processOnce(CONSUMER, EventType.ORDER_CREATED, meta, async (transaction) => {
    shortfall = null;
    reserved = [];

    for (const item of items) {
      const { productId, quantity } = item;

      if (!Number.isInteger(quantity) || quantity <= 0) {
        shortfall = { productId, requested: quantity };
        break;
      }

      /*
       * Atomic conditional decrement. The WHERE clause and the write happen in
       * one statement, so the row is locked for the duration and a competing
       * transaction cannot read the same starting value. If the row is missing
       * or has too little stock, zero rows are affected and we know to fail.
       *
       * This replaces findOne() followed by decrement(), which was a
       * read-modify-write race that could drive stock negative.
       */
      const updated = await sequelize.query<{ productId: number }>(
        `UPDATE "Stocks"
            SET stock = stock - :quantity
          WHERE "productId" = :productId
            AND stock >= :quantity
      RETURNING "productId"`,
        {
          replacements: { productId, quantity },
          type: QueryTypes.SELECT,
          transaction,
        }
      );

      if (updated.length === 0) {
        shortfall = { productId, requested: quantity };
        // Throwing would also roll back, but we want a clean, explicit exit
        // that lets us publish a failure event after the rollback.
        break;
      }

      await OrderReservation.upsert(
        { orderId, productId, reservedQuantity: quantity, status: "pending" },
        { transaction }
      );

      reserved.push(item);
    }

    if (shortfall) {
      // All-or-nothing: undo every decrement made above in this transaction.
      throw new InsufficientStock(shortfall);
    }
  }).catch((error: unknown) => {
    if (error instanceof InsufficientStock) {
      shortfall = error.detail;
      reserved = [];
      return;
    }
    throw error;
  });

  if (shortfall) {
    const detail = shortfall as { productId: number; requested: number };
    logger.warn(
      `Insufficient stock for order ${orderId}: product ${detail.productId} ` +
        `wanted ${detail.requested}. Nothing reserved.`
    );
    await publish(
      EventType.RESERVATION_FAILED,
      {
        orderId,
        productId: detail.productId,
        requestedQuantity: detail.requested,
        reason: "insufficient_stock",
        failedAt: new Date().toISOString(),
      },
      { correlationId, causationId }
    );
    return;
  }

  for (const item of reserved) {
    await publish(
      EventType.STOCK_RESERVED,
      { productId: item.productId, orderId, quantity: item.quantity },
      { correlationId, causationId }
    );
  }

  logger.info(
    `Reserved ${reserved.length} item(s) for order ${orderId}`
  );
}

/** Internal signal used to roll the reservation transaction back. */
class InsufficientStock extends Error {
  constructor(public detail: { productId: number; requested: number }) {
    super(`insufficient stock for product ${detail.productId}`);
    this.name = "InsufficientStock";
  }
}

export async function startOrderReservationEventService() {
  await subscribeEvent(
    EventType.ORDER_CREATED,
    async (payload: any, meta) => {
      logger.info(`Received ${EventType.ORDER_CREATED}`, {
        correlationId: meta.correlationId,
      });
      await handleOrderReservationEvent(payload, meta);
    },
    { queue: "inventory-service.order-created" }
  );

  logger.info("Order reservation service started");
}
