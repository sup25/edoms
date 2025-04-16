import amqplib from "amqplib";
import { BrokerConfig } from "../config/brokerConfig";
import logger from "../utils/logger";

/**
 * Publishes an event to a RabbitMQ exchange with retry logic.
 *
 * @param exchangeName - The exchange to publish to.
 * @param routingKey - The routing key (use "" for fanout).
 * @param eventType - The type of event (e.g., "order_created").
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
  exchangeType: "fanout" | "direct" | "topic" = "direct",
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<void> {
  if (maxRetries === 0) {
    logger.warn(`Publishing ${eventType} skipped due to maxRetries = 0`);
    return;
  }
  let attempts = 0;

  while (attempts <= maxRetries) {
    let connection;
    let channel;
    try {
      connection = await amqplib.connect(BrokerConfig.amqpUrl);
      channel = await connection.createChannel();

      await channel.assertExchange(exchangeName, exchangeType, {
        durable: true,
      });

      const message = JSON.stringify({ event: eventType, data });
      channel.publish(exchangeName, routingKey, Buffer.from(message));
      logger.info(`Event published: ${eventType}`, message);

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
    } finally {
      try {
        if (channel) await channel.close();
        if (connection) await connection.close();
      } catch (cleanupError) {
        logger.warn("Error during AMQP cleanup", cleanupError);
      }
    }
  }
}
