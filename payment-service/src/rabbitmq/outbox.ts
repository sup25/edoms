import { randomUUID } from "crypto";
import { QueryTypes, Transaction } from "sequelize";
import { EventType, validatePayload } from "@edoms/shared-events";
import sequelize from "../config/db";
import OutboxEvent from "../model/outbox.model";
import { publish } from "./publisher";
import logger from "../utils/logger";

export interface OutboxOptions {
  correlationId?: string;
  causationId?: string;
}

/**
 * Records an event to be published, inside the caller's transaction.
 *
 * This is the only correct way to emit an event that accompanies a database
 * change. Publishing directly leaves a window where the change is committed
 * but the event is not, or vice versa.
 *
 * Returns the eventId, which is stable across relay retries so consumers can
 * deduplicate on it.
 */
export async function publishToOutbox<T>(
  eventType: EventType,
  payload: T,
  transaction: Transaction,
  options: OutboxOptions = {}
): Promise<string> {
  // Fail inside the caller's transaction, so a bad payload rolls back the
  // domain change rather than being discovered later by the relay.
  validatePayload(eventType, payload);

  const eventId = randomUUID();

  await OutboxEvent.create(
    {
      eventId,
      eventType,
      // JSON round-trip so Dates become ISO strings now rather than at
      // publish time, keeping the stored row identical to what goes on the wire.
      payload: JSON.parse(JSON.stringify(payload)),
      correlationId: options.correlationId ?? randomUUID(),
      causationId: options.causationId ?? null,
      status: "pending",
      attempts: 0,
      availableAt: new Date(),
      createdAt: new Date(),
    },
    { transaction }
  );

  return eventId;
}

const BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE || 50);
const POLL_MS = Number(process.env.OUTBOX_POLL_MS || 1000);
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS || 10);

let running = false;
let timer: NodeJS.Timeout | null = null;

interface ClaimedRow {
  id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  correlation_id: string;
  causation_id: string | null;
  attempts: number;
}

/**
 * Publishes one batch of pending events.
 *
 * Rows are claimed with FOR UPDATE SKIP LOCKED so several replicas can run the
 * relay concurrently without publishing the same row twice or blocking each
 * other.
 *
 * Exported for tests and for a manual drain.
 */
export async function drainOutbox(): Promise<number> {
  const rows = await sequelize.query<ClaimedRow>(
    `SELECT id, event_id, event_type, payload, correlation_id, causation_id, attempts
       FROM outbox_events
      WHERE status = 'pending'
        AND available_at <= NOW()
      ORDER BY id
      LIMIT :limit
      FOR UPDATE SKIP LOCKED`,
    { replacements: { limit: BATCH_SIZE }, type: QueryTypes.SELECT }
  );

  if (rows.length === 0) return 0;

  let sent = 0;

  for (const row of rows) {
    try {
      await publish(row.event_type as EventType, row.payload, {
        correlationId: row.correlation_id,
        causationId: row.causation_id ?? undefined,
        eventId: row.event_id,
        // The relay is the retry mechanism; don't retry inside publish too.
        maxRetries: 0,
      });

      await sequelize.query(
        `UPDATE outbox_events
            SET status = 'sent', sent_at = NOW(), last_error = NULL
          WHERE id = :id`,
        { replacements: { id: row.id }, type: QueryTypes.UPDATE }
      );
      sent++;
    } catch (error: unknown) {
      const attempts = row.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      // Exponential backoff, capped, so a broker outage does not spin.
      const backoffSeconds = Math.min(2 ** attempts, 300);
      const exhausted = attempts >= MAX_ATTEMPTS;

      await sequelize.query(
        `UPDATE outbox_events
            SET attempts = :attempts,
                last_error = :error,
                status = :status,
                available_at = NOW() + (:backoff || ' seconds')::interval
          WHERE id = :id`,
        {
          replacements: {
            id: row.id,
            attempts,
            error: message.slice(0, 1000),
            status: exhausted ? "failed" : "pending",
            backoff: backoffSeconds,
          },
          type: QueryTypes.UPDATE,
        }
      );

      if (exhausted) {
        // Terminal: needs a human, same role as a dead-letter queue.
        logger.error(
          `Outbox event ${row.event_id} (${row.event_type}) FAILED permanently ` +
            `after ${attempts} attempts: ${message}`
        );
      } else {
        logger.warn(
          `Outbox event ${row.event_id} (${row.event_type}) attempt ${attempts} ` +
            `failed, retrying in ${backoffSeconds}s: ${message}`
        );
      }
    }
  }

  if (sent > 0) logger.info(`Outbox relay published ${sent} event(s)`);
  return sent;
}

async function tick(): Promise<void> {
  if (!running) return;
  try {
    // Keep draining while full batches come back, so a backlog clears quickly
    // instead of one batch per poll interval.
    let sent = 0;
    do {
      sent = await drainOutbox();
    } while (running && sent === BATCH_SIZE);
  } catch (error: unknown) {
    logger.error("Outbox relay tick failed", error);
  } finally {
    if (running) timer = setTimeout(tick, POLL_MS).unref?.() ?? null;
  }
}

export function startOutboxRelay(): void {
  if (running) return;
  running = true;
  logger.info(`Outbox relay started (poll ${POLL_MS}ms, batch ${BATCH_SIZE})`);
  timer = setTimeout(tick, POLL_MS).unref?.() ?? null;
}

export function stopOutboxRelay(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
