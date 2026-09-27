import {
  EventType,
  EXCHANGE_FOR,
  buildEnvelope,
  validatePayload,
} from "@edoms/shared-events";
import { getPublishChannel } from "./connection";
import logger from "../utils/logger";

const PRODUCER = "order-service";

export interface PublishOptions {
  /** Ties this event to the business transaction that caused it. */
  correlationId?: string;
  /** eventId of the event being reacted to, if any. */
  causationId?: string;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Publishes a domain event.
 *
 * Phase 2: the caller names the event and nothing else. The exchange and
 * routing key are derived from the shared catalogue, so a publisher and a
 * consumer can no longer disagree about where an event lives - which is
 * exactly how the `invetory_service` typo went unnoticed.
 *
 * The payload is validated before it leaves the process, so a malformed event
 * fails here, at its source, rather than in a consumer three services away.
 */
export async function publish<T>(
  eventType: EventType,
  payload: T,
  options: PublishOptions = {}
): Promise<string> {
  const { correlationId, causationId, maxRetries = 3, retryDelay = 1000 } = options;

  const exchange = EXCHANGE_FOR[eventType];
  if (!exchange) {
    throw new Error(`No exchange registered for event type ${eventType}`);
  }

  // Fail fast at the producer rather than dead-lettering at the consumer.
  validatePayload(eventType, payload);

  const envelope = buildEnvelope(eventType, payload, {
    producer: PRODUCER,
    correlationId,
    causationId,
  });
  const body = Buffer.from(JSON.stringify(envelope));

  let attempts = 0;
  while (attempts <= maxRetries) {
    try {
      const channel = await getPublishChannel();
      await channel.assertExchange(exchange, "topic", { durable: true });

      await new Promise<void>((resolve, reject) => {
        channel.publish(
          exchange,
          eventType, // routing key IS the event name
          body,
          {
            persistent: true,
            contentType: "application/json",
            messageId: envelope.eventId,
            correlationId: envelope.correlationId,
            timestamp: Date.now(),
            type: eventType,
            appId: PRODUCER,
          },
          (error) => (error ? reject(error) : resolve())
        );
      });

      logger.info(`Published ${eventType}`, {
        eventId: envelope.eventId,
        correlationId: envelope.correlationId,
        exchange,
      });
      return envelope.eventId;
    } catch (error: unknown) {
      attempts++;
      const message = error instanceof Error ? error.message : String(error);

      if (attempts > maxRetries) {
        logger.error(`Failed to publish ${eventType} after ${maxRetries} retries`, error);
        throw new Error(`Failed to publish ${eventType}: ${message}`);
      }

      logger.warn(`Retry ${attempts}/${maxRetries} for ${eventType}`, error);
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }

  throw new Error(`Failed to publish ${eventType}`);
}
