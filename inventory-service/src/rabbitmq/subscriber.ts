import amqp from "amqplib";
import { handleCreateProductEvent } from "../handler/createProductEventHandler";
import { handleOrderCreatedEvent } from "../handler/handleOrderCreatedEvent";

export async function subscribeToEvents(): Promise<void> {
  try {
    const conn = await amqp.connect("amqp://localhost:5672");
    const channel = await conn.createChannel();
    if (!channel) {
      throw new Error("Failed to create RabbitMQ channel");
    }

    // Product events subscription (unchanged)
    const productExchange = "product.events";
    await channel.assertExchange(productExchange, "fanout", { durable: false });
    const productQueue = await channel.assertQueue("", { exclusive: true });
    await channel.bindQueue(productQueue.queue, productExchange, "");
    console.log("Waiting for product events on exchange:", productExchange);

    // Order events subscription
    const orderExchange = "order_exchange";
    const orderRoutingKey = "order_created";
    await channel.assertExchange(orderExchange, "direct", { durable: true });
    const orderQueue = await channel.assertQueue("", { exclusive: true }); // Anonymous queue
    await channel.bindQueue(orderQueue.queue, orderExchange, orderRoutingKey);
    console.log("Waiting for order events on exchange:", orderExchange);

    console.log("Waiting for events...");

    // Consume product events (unchanged)
    await channel.consume(
      productQueue.queue,
      async (message) => {
        if (message !== null) {
          try {
            const event = JSON.parse(message.content.toString());
            await handleCreateProductEvent(event);
            channel.ack(message);
          } catch (error) {
            console.error("Error processing product message:", error);
          }
        }
      },
      { noAck: false }
    );

    // Consume order events
    await channel.consume(
      orderQueue.queue,
      async (message) => {
        if (message !== null && channel) {
          try {
            const { event, data } = JSON.parse(message.content.toString());
            console.log(`Received event ${event} in inventory-service:`, data);
            await handleOrderCreatedEvent({ action: event, ...data });

            channel.ack(message);
          } catch (error) {
            console.error("Error processing order event:", error);
          }
        }
      },
      { noAck: false }
    );

    conn.on("close", () => console.log("RabbitMQ connection closed"));
    conn.on("error", (err) => console.error("RabbitMQ connection error:", err));
  } catch (err) {
    console.error("Error subscribing to events:", err);
  }
}
