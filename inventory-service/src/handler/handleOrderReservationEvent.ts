import { QueryTypes } from "sequelize";
import sequelize from "../config/db";
import OrderReservation from "../model/orderReservation.model";
import { publishEvent } from "../rabbitmq/publisher";
import { subscribeEvent } from "../rabbitmq/subscriber";
import { processOnce, EventMeta } from "../utils/idempotency";
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
  eventType: string,
  event: OrderCreatedEvent,
  meta?: EventMeta
) {
  if (eventType !== "order_created") {
    logger.error(`Unhandled event type: ${eventType}`);
    return;
  }

  const { orderId, items } = event;

  if (!orderId || !Array.isArray(items) || items.length === 0) {
    logger.error(`Malformed order_created event for order ${orderId}`);
    return;
  }

  // Collected inside the transaction, acted on after it commits.
  let shortfall: { productId: number; requested: number } | null = null;
  let reserved: OrderItem[] = [];

  await processOnce(CONSUMER, eventType, meta, async (transaction) => {
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
    await publishEvent(
      "inventory_service",
      "reservation_failed",
      "reservation failed",
      {
        orderId,
        productId: detail.productId,
        requestedQuantity: detail.requested,
        reason: "insufficient_stock",
        failedAt: new Date().toISOString(),
      }
    );
    return;
  }

  for (const item of reserved) {
    await publishEvent("inventory_service", "stock_decrement", "Stock Decrement", {
      productId: item.productId,
    });
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
    "order_service",
    "create_order",
    "direct",
    async (eventType: string, data: any, meta) => {
      logger.info(`Received event: ${eventType}`, data);
      await handleOrderReservationEvent(eventType, data, meta);
    },
    { queue: "inventory-service.order-created" }
  );

  logger.info("Order reservation service started");
}
