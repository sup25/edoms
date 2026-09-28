import type { ConsumeMessage } from "amqplib";
import {
  EventType,
  EXCHANGE_FOR,
  EventEnvelope,
  EventContractError,
  parseEnvelope,
  validatePayload,
} from "@edoms/shared-events";
import { createConsumerChannel, registerResubscriber } from "./connection";
import { assertEventTopology, deliveryAttempt } from "./topology";
import {
  addContext,
  eventHandlerDuration,
  eventsConsumed,
  runWithContext,
} from "@edoms/shared-observability";
import logger from "../utils/logger";
import { registerQueue } from "./queueMonitor";

export interface SubscribeOptions {
  /** Durable queue name, e.g. "order-service.reservation-confirmed". */
  queue: string;
  prefetch?: number;
  maxDeliveries?: number;
  retryDelayMs?: number;
}

export interface EventMeta {
  messageId?: string;
  correlationId: string;
  causationId?: string;
  attempt: number;
  queue: string;
}

export type EventHandler<T = unknown> = (
  payload: T,
  meta: EventMeta,
  envelope: EventEnvelope<T>
) => Promise<void> | void;

/**
 * Subscribes to one domain event.
 *
 * Phase 2: the caller names the event; the exchange and binding key come from
 * the shared catalogue, so producer and consumer cannot drift apart. The
 * envelope is parsed and the payload validated before the handler runs, so
 * business logic only ever sees well-formed data.
 *
 * A contract violation is dead-lettered immediately rather than retried - a
 * payload of the wrong shape will not become the right shape on attempt four.
 */
export async function subscribeEvent<T = unknown>(
  eventType: EventType,
  handler: EventHandler<T>,
  options: SubscribeOptions
): Promise<void> {
  const { queue, prefetch = 10, maxDeliveries = 5, retryDelayMs = 5_000 } = options;

  const exchange = EXCHANGE_FOR[eventType];
  if (!exchange) {
    throw new Error(`No exchange registered for event type ${eventType}`);
  }

  const attach = async (): Promise<void> => {
    const channel = await createConsumerChannel();

    channel.on("error", (error: unknown) => {
      logger.error(`Consumer channel error for ${queue}`, error);
    });

    const topology = await assertEventTopology(channel, {
      exchange,
      exchangeType: "topic",
      routingKey: eventType,
      queue,
      retryDelayMs,
    });

    await channel.prefetch(prefetch);

    const deadLetter = (msg: ConsumeMessage, reason: string): void => {
      channel.publish("", topology.deadQueue, msg.content, {
        ...msg.properties,
        headers: {
          ...(msg.properties.headers ?? {}),
          "x-death-reason": reason,
          "x-original-exchange": exchange,
          "x-original-routing-key": eventType,
        },
        persistent: true,
      });
      channel.ack(msg);
    };

    await channel.consume(
      topology.queue,
      async (msg) => {
        if (!msg) return;
        const attempt = deliveryAttempt(msg.properties.headers);

        /*
         * The context is established BEFORE the envelope is parsed, seeded
         * from the AMQP properties.
         *
         * Everything below - and everything it awaits - then runs inside it,
         * so each log line carries the correlationId of the transaction that
         * caused it without any handler passing it anywhere. This is the half
         * of "propagate the correlationId" that Phase 2 left open: the id was
         * already on the wire, just not in the logs.
         *
         * Parsing is inside rather than before it because a malformed event is
         * the case where you most need to know which queue and which message,
         * and it is dead-lettered on first delivery - so that one log line
         * would otherwise be the only one with nothing to trace it by.
         */
        await runWithContext(
          {
            correlationId: msg.properties.correlationId,
            messageId: msg.properties.messageId,
            eventType,
            queue: topology.queue,
            attempt,
          },
          async () => {
            let envelope: EventEnvelope;
            let payload: T;
            try {
              envelope = parseEnvelope(msg.content.toString());
              if (envelope.eventType !== eventType) {
                throw new EventContractError(
                  `expected ${eventType} on ${queue}, got ${envelope.eventType}`
                );
              }
              payload = validatePayload<T>(eventType, envelope.payload);
            } catch (error: unknown) {
              // Contract violations are permanent. Retrying wastes capacity.
              // `reason`, not `message`: a meta key called `message` overwrites
              // the log line's own message, which used to replace "contract
              // violation on <queue>, dead-lettering" with the bare validation
              // error - losing both the queue and the fact that it was dropped.
              logger.error(`Contract violation on ${queue}, dead-lettering`, {
                reason:
                  error instanceof Error ? error.message : String(error),
                ...(error instanceof EventContractError && error.detail !== undefined
                  ? { detail: error.detail }
                  : {}),
              });
              eventsConsumed.labels(eventType, topology.queue, "contract-violation").inc();
              deadLetter(msg, "contract-violation");
              return;
            }

            const meta: EventMeta = {
              messageId: msg.properties.messageId || envelope.eventId,
              correlationId: envelope.correlationId,
              causationId: envelope.eventId,
              attempt,
              queue: topology.queue,
            };

            // The envelope is the authority once it parses; the AMQP property
            // is only a hint, and a legacy message has none at all.
            addContext({
              correlationId: meta.correlationId,
              causationId: meta.causationId,
              messageId: meta.messageId,
            });

            const startedAt = process.hrtime.bigint();
            const elapsed = (): number =>
              Number(process.hrtime.bigint() - startedAt) / 1e9;

            try {
              await handler(payload, meta, envelope as EventEnvelope<T>);
              channel.ack(msg);
              eventHandlerDuration.labels(eventType, topology.queue, "ack").observe(elapsed());
              eventsConsumed.labels(eventType, topology.queue, "ack").inc();
            } catch (error: unknown) {
              if (attempt >= maxDeliveries) {
                logger.error(
                  `Handler for ${eventType} on ${queue} failed after ${attempt} attempts, dead-lettering`,
                  error
                );
                eventHandlerDuration
                  .labels(eventType, topology.queue, "dead-lettered")
                  .observe(elapsed());
                eventsConsumed.labels(eventType, topology.queue, "dead-lettered").inc();
                deadLetter(msg, "max-deliveries-exceeded");
                return;
              }
              logger.warn(
                `Handler for ${eventType} on ${queue} failed (attempt ${attempt}/${maxDeliveries}), ` +
                  `retrying in ${retryDelayMs}ms`,
                error
              );
              eventHandlerDuration.labels(eventType, topology.queue, "retried").observe(elapsed());
              eventsConsumed.labels(eventType, topology.queue, "retried").inc();
              channel.nack(msg, false, false);
            }
          }
        );
      },
      { noAck: false }
    );

    // So the queue monitor knows which queues belong to this service.
    registerQueue(topology);

    logger.info(`Subscribed to ${eventType} on ${exchange} via queue ${topology.queue}`);
  };

  await attach();
  registerResubscriber(attach);
}
