import { Op } from "sequelize";
import { EventType } from "@edoms/shared-events";
import sequelize from "../config/db";
import Order from "../model/order.model";
import { IN_FLIGHT_STATUSES } from "../model/order.model";
import type { OrderStatus } from "../model/order.model";
import { publishToOutbox } from "../rabbitmq/outbox";
import logger from "../utils/logger";

/**
 * Expires orders that have been in flight too long.
 *
 * An async saga has no natural failure: if an event is lost, or a consumer
 * never comes back, the order simply waits. Before Phase 5 that was invisible
 * because the client was driving anyway. Now that the system owns the whole
 * chain, it also has to own the case where the chain stops.
 *
 * An order stuck in `pending` or `reserved` past the deadline is cancelled and
 * `order.cancelled` is published, so inventory releases any stock it is
 * holding. `paid` is deliberately NOT expired: money has changed hands, and
 * that needs a human, not a timer.
 */

const TIMEOUT_MS = Number(process.env.SAGA_TIMEOUT_MS || 5 * 60 * 1000);
const SWEEP_MS = Number(process.env.SAGA_SWEEP_MS || 30 * 1000);

/** Only these are safe to expire automatically. */
const EXPIRABLE: OrderStatus[] = IN_FLIGHT_STATUSES.filter(
  (s) => s !== "paid"
);

let running = false;
let timer: NodeJS.Timeout | null = null;

/** Cancels every order past its deadline. Exported for tests. */
export async function expireStaleOrders(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - TIMEOUT_MS);

  const stale = await Order.findAll({
    where: {
      status: { [Op.in]: EXPIRABLE },
      createdAt: { [Op.lt]: cutoff },
    },
    limit: 100,
  });

  if (stale.length === 0) return 0;

  let cancelled = 0;

  for (const order of stale) {
    const previous = order.status;

    try {
      await sequelize.transaction(async (transaction) => {
        // Re-check inside the transaction: a saga event may have landed
        // between the query above and now.
        const fresh = await Order.findByPk(order.id, { transaction });
        if (!fresh || !EXPIRABLE.includes(fresh.status)) return;

        await fresh.update({ status: "cancelled" }, { transaction });

        await publishToOutbox(
          EventType.RESERVATION_FAILED,
          {
            orderId: order.id,
            reason: "saga_timeout",
            failedAt: new Date().toISOString(),
          },
          transaction
        );
      });

      cancelled++;
      logger.warn(
        `Order ${order.id} timed out in '${previous}' after ` +
          `${Math.round(TIMEOUT_MS / 1000)}s and was cancelled`
      );
    } catch (error: unknown) {
      logger.error(`Failed to expire order ${order.id}`, error);
    }
  }

  return cancelled;
}

async function sweep(): Promise<void> {
  if (!running) return;
  try {
    await expireStaleOrders();
  } catch (error: unknown) {
    logger.error("Saga timeout sweep failed", error);
  } finally {
    if (running) timer = setTimeout(sweep, SWEEP_MS).unref?.() ?? null;
  }
}

export function startSagaTimeoutWorker(): void {
  if (running) return;
  running = true;
  logger.info(
    `Saga timeout worker started (timeout ${TIMEOUT_MS}ms, sweep ${SWEEP_MS}ms)`
  );
  timer = setTimeout(sweep, SWEEP_MS).unref?.() ?? null;
}

export function stopSagaTimeoutWorker(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
