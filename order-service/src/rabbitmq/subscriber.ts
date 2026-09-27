import type { ConsumeMessage } from "amqplib";
import { createConsumerChannel, registerResubscriber } from "./connection";
import { assertEventTopology, deliveryAttempt } from "./topology";
import type { ExchangeType } from "./topology";
import logger from "../utils/logger";

export interface SubscribeOptions {
  /**
   * Durable queue name, e.g. "order-service.order-confirmed".
   *
   * Required. Previously this was an anonymous exclusive queue, which meant
   * every event published while the service was down was lost, and each
   * replica received its own copy instead of sharing the work.
   */
  queue: string;
  /** Unacked messages allowed in flight per consumer. */
  prefetch?: number;
  /** Total attempts before the message is parked in <queue>.dead. */
  maxDeliveries?: number;
  /** How long a failed message waits before being retried. */
  retryDelayMs?: number;
}

/**
 * Subscribes to events from a RabbitMQ exchange.
 *
 * Delivery guarantees (Phase 1):
 * - durable, named queue, so events survive a consumer restart
 * - the message is acked only after the handler resolves; a handler that
 *   throws sends the message down the retry path instead of being silently
 *   dropped
 * - bounded retries, then a terminal dead-letter queue
 * - consumers re-attach automatically after a reconnect
 *
 * @param exchangeName - The exchange to subscribe to.
 * @param routingKey - The routing key to bind the queue with.
 * @param exchangeType - The type of exchange (default: "direct").
 * @param handler - Callback that processes the message.
 * @param options - Queue name and delivery tuning.
 */
/** Delivery metadata passed to handlers so they can deduplicate redeliveries. */
export interface EventMeta {
  /** Broker messageId set by the publisher. Undefined for events injected by
   *  hand (e.g. the RabbitMQ management UI), in which case dedupe is skipped. */
  messageId?: string;
  /** 1 on first delivery, incrementing on each retry. */
  attempt: number;
  queue: string;
}

export async function subscribeEvent(
  exchangeName: string,
  routingKey: string,
  exchangeType: ExchangeType = "direct",
  handler: (
    eventType: string,
    data: any,
    meta: EventMeta
  ) => Promise<void> | void,
  options: SubscribeOptions
): Promise<void> {
  const {
    queue,
    prefetch = 10,
    maxDeliveries = 5,
    retryDelayMs = 5_000,
  } = options;

  const attach = async (): Promise<void> => {
    const channel = await createConsumerChannel();

    channel.on("error", (error: unknown) => {
      logger.error(`Consumer channel error for ${queue}`, error);
    });

    const topology = await assertEventTopology(channel, {
      exchange: exchangeName,
      exchangeType,
      routingKey,
      queue,
      retryDelayMs,
    });

    // Bound in-flight work so one consumer cannot swallow the whole backlog.
    await channel.prefetch(prefetch);

    const sendToDeadLetter = (msg: ConsumeMessage, reason: string): void => {
      channel.publish("", topology.deadQueue, msg.content, {
        ...msg.properties,
        headers: {
          ...(msg.properties.headers ?? {}),
          "x-death-reason": reason,
          "x-original-exchange": exchangeName,
          "x-original-routing-key": routingKey,
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

        // Unparseable content will never parse. Retrying is pointless, so it
        // goes straight to the dead-letter queue.
        let event: string;
        let data: unknown;
        try {
          const parsed = JSON.parse(msg.content.toString());
          event = parsed.event;
          data = parsed.data;
          if (typeof event !== "string") {
            throw new Error("missing 'event' field");
          }
        } catch (error: unknown) {
          logger.error(`Malformed message on ${queue}, dead-lettering`, error);
          sendToDeadLetter(msg, "malformed");
          return;
        }

        try {
          // The whole point of Phase 1: await the handler BEFORE acking.
          await handler(event, data, {
            messageId: msg.properties.messageId || undefined,
            attempt,
            queue: topology.queue,
          });
          channel.ack(msg);
        } catch (error: unknown) {
          if (attempt >= maxDeliveries) {
            logger.error(
              `Handler for ${event} on ${queue} failed after ${attempt} attempts, dead-lettering`,
              error
            );
            sendToDeadLetter(msg, "max-deliveries-exceeded");
            return;
          }

          logger.warn(
            `Handler for ${event} on ${queue} failed (attempt ${attempt}/${maxDeliveries}), retrying in ${retryDelayMs}ms`,
            error
          );
          // requeue=false dead-letters into <queue>.retry, which returns the
          // message to the main queue once its TTL expires.
          channel.nack(msg, false, false);
        }
      },
      { noAck: false }
    );

    logger.info(
      `Subscribed to ${exchangeName} on queue ${topology.queue} with routing key ${routingKey}`
    );
  };

  await attach();

  // Re-attach this consumer after a reconnect.
  registerResubscriber(attach);
}
