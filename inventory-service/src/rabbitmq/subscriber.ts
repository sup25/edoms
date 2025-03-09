import amqp from "amqplib";

import { handleCreateProductEvent } from "../handler/createProductEventHandler";

export async function subscribeToProductEvents(): Promise<void> {
  try {
    const conn = await amqp.connect("amqp://localhost:5672");
    const channel = await conn.createChannel();
    const exchange = "product.events";

    await channel.assertExchange(exchange, "fanout", { durable: false });

    const queue = await channel.assertQueue("", { exclusive: true });
    await channel.bindQueue(queue.queue, exchange, "");
    console.log("Waiting for product events...");

    await channel.consume(
      queue.queue,
      async (message) => {
        if (message !== null) {
          try {
            const event = JSON.parse(message.content.toString());
            await handleCreateProductEvent(event);
            channel.ack(message);
          } catch (error) {
            console.error("Error processing message:", error);
          }
        }
      },
      { noAck: false }
    );

    conn.on("close", () => console.log("RabbitMQ connection closed"));
    conn.on("error", (err) => console.error("RabbitMQ connection error:", err));
  } catch (err) {
    console.error("Error subscribing to product events:", err);
  }
}
