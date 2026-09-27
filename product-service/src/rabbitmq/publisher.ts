import { randomUUID } from "crypto";
import { getPublishChannel } from "./connection";
import type { ExchangeType } from "./topology";
import logger from "../utils/logger";

/**
 * Publishes an event to a RabbitMQ exchange.
 *
 * Durability guarantees (Phase 1):
 * - reuses one long-lived connection instead of dialling per publish
 * - messages are marked persistent so they survive a broker restart
 * - uses a confirm channel and waits for the broker ack, so this resolves only
 *   once the broker has actually taken responsibility for the message
 *
 * @param exchangeName - The exchange to publish to.
 * @param routingKey - The routing key (use "" for fanout).
 * @param eventType - The type of event (e.g. "order_created").
 * @param data - The event payload.
 * @param exchangeType - The type of exchange (default: "direct").
 * @param maxRetries - Number of retry attempts (default: 3).
 * @param retryDelay - Delay between retries in ms (default: 1000).
 */
export async function publishEvent(
  exchangeName: string,
  routingKey: string,
  eventType: string,
  data: any,
  exchangeType: ExchangeType = "direct",
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<void> {
  if (maxRetries === 0) {
    logger.warn(`Publishing ${eventType} skipped due to maxRetries = 0`);
    return;
  }

  const messageId = randomUUID();
  const payload = Buffer.from(JSON.stringify({ event: eventType, data }));

  let attempts = 0;

  while (attempts <= maxRetries) {
    try {
      const channel = await getPublishChannel();
      await channel.assertExchange(exchangeName, exchangeType, {
        durable: true,
      });

      // Resolves when the broker confirms the message, rejects if it is lost.
      await new Promise<void>((resolve, reject) => {
        channel.publish(
          exchangeName,
          routingKey,
          payload,
          {
            persistent: true,
            contentType: "application/json",
            messageId,
            timestamp: Date.now(),
            type: eventType,
          },
          (error) => (error ? reject(error) : resolve())
        );
      });

      logger.info(`Event published: ${eventType}`, {
        messageId,
        exchangeName,
        routingKey,
      });
      return;
    } catch (error: unknown) {
      attempts++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (attempts > maxRetries) {
        logger.error(
          `Failed to publish ${eventType} after ${maxRetries} retries`,
          error
        );
        throw new Error(`Failed to publish ${eventType}: ${errorMessage}`);
      }

      logger.warn(`Retry ${attempts}/${maxRetries} for ${eventType}`, error);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}
