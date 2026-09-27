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
import logger from "../utils/logger";

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
          logger.error(
            `Contract violation on ${queue}, dead-lettering`,
            error instanceof EventContractError
              ? { message: error.message, detail: error.detail }
              : error
          );
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

        try {
          await handler(payload, meta, envelope as EventEnvelope<T>);
          channel.ack(msg);
        } catch (error: unknown) {
          if (attempt >= maxDeliveries) {
            logger.error(
              `Handler for ${eventType} on ${queue} failed after ${attempt} attempts ` +
                `(correlationId=${meta.correlationId}), dead-lettering`,
              error
            );
            deadLetter(msg, "max-deliveries-exceeded");
            return;
          }
          logger.warn(
            `Handler for ${eventType} on ${queue} failed (attempt ${attempt}/${maxDeliveries}, ` +
              `correlationId=${meta.correlationId}), retrying in ${retryDelayMs}ms`,
            error
          );
          channel.nack(msg, false, false);
        }
      },
      { noAck: false }
    );

    logger.info(`Subscribed to ${eventType} on ${exchange} via queue ${topology.queue}`);
  };

  await attach();
  registerResubscriber(attach);
}
