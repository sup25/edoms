import amqplib from "amqplib";
import { BrokerConfig } from "../config/brokerConfig";
import logger from "../utils/logger";

/**
 * Subscribes to events from a RabbitMQ exchange with retry logic.
 *
 * @param exchangeName - The exchange to subscribe to.
 * @param routingKey - The routing key to bind the queue (required for direct exchange).
 * @param exchangeType - The type of exchange (default: "direct").
 * @param handler - Callback function to process the message.
 * @param maxRetries - Number of retry attempts (default: 3).
 * @param retryDelay - Delay between retries in ms (default: 1000).
 */
export async function subscribeEvent(
  exchangeName: string,
  routingKey: string,
  exchangeType: "fanout" | "direct" | "topic" = "direct",
  handler: (eventType: string, data: any) => Promise<void> | void,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<void> {
  let attempts = 0;

  while (attempts <= maxRetries) {
    try {
      const connection = await amqplib.connect(BrokerConfig.amqpUrl);
      const channel = await connection.createChannel();

      // Assert exchange
      await channel.assertExchange(exchangeName, exchangeType, {
        durable: true,
      });

      // Assert queue (auto-generated exclusive queue)
      const q = await channel.assertQueue("", {
        exclusive: true,
      });

      // Bind queue to exchange with the specified routing key
      await channel.bindQueue(q.queue, exchangeName, routingKey);

      // Consume messages
      await channel.consume(
        q.queue,
        (msg) => {
          if (msg) {
            try {
              const { event, data } = JSON.parse(msg.content.toString());
              Promise.resolve(handler(event, data)).catch((err) =>
                logger.error(`Error in handler for event ${event}:`, err)
              );
              channel.ack(msg);
            } catch (error: unknown) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              logger.error("Failed to parse message:", errorMessage);
              channel.nack(msg, false, false);
            }
          }
        },
        { noAck: false }
      );

      logger.info(
        `Subscribed to ${exchangeName} with queue ${q.queue} and routing key ${routingKey}`
      );
      return; // Success, exit loop
    } catch (error: unknown) {
      attempts++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (attempts > maxRetries) {
        logger.error(
          `Failed to subscribe to ${exchangeName} after ${maxRetries} retries:`,
          errorMessage
        );
        throw new Error(
          `Failed to subscribe to ${exchangeName}: ${errorMessage}`
        );
      }
      logger.warn(
        `Retry ${attempts}/${maxRetries} for ${exchangeName}:`,
        errorMessage
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}
