import { Transaction, UniqueConstraintError } from "sequelize";
import sequelize from "../config/db";
import ProcessedEvent from "../model/processedEvent.model";
import logger from "./logger";

export interface EventMeta {
  messageId?: string;
  attempt: number;
  queue: string;
}

/**
 * Runs `work` exactly once per (consumer, event), inside one transaction.
 *
 * The ledger insert and the domain change commit together, so a crash between
 * them cannot leave an event marked processed without its effect, or vice
 * versa. A redelivery hits the primary key and is skipped.
 *
 * Returns true if the work ran, false if it was a duplicate.
 *
 * If the event has no messageId - for instance one injected by hand through
 * the RabbitMQ management UI - there is nothing stable to deduplicate on, so
 * the work runs unprotected and a warning is logged.
 */
export async function processOnce(
  consumer: string,
  eventType: string,
  meta: EventMeta | undefined,
  work: (transaction: Transaction) => Promise<void>
): Promise<boolean> {
  const messageId = meta?.messageId;

  if (!messageId) {
    logger.warn(
      `[${consumer}] event ${eventType} has no messageId; running without ` +
        `idempotency protection`
    );
    await sequelize.transaction(async (transaction) => work(transaction));
    return true;
  }

  const eventId = `${consumer}:${messageId}`;

  try {
    await sequelize.transaction(async (transaction) => {
      // Claim the event first. If this throws on the unique constraint the
      // whole transaction rolls back and the domain change never happens.
      await ProcessedEvent.create(
        { eventId, eventType, consumer, processedAt: new Date() },
        { transaction }
      );
      await work(transaction);
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof UniqueConstraintError) {
      logger.info(
        `[${consumer}] skipping duplicate ${eventType} (messageId=${messageId})`
      );
      return false;
    }
    throw error;
  }
}
