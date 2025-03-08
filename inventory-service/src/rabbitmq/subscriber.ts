import amqp from "amqplib";

// Interface to type the event data (optional but recommended)
interface ProductEvent {
  action: string;
  product: {
    id: number;
    name: string;
    price: number;
    slug: string;
    createdAt: string;
    updatedAt: string;
  };
}

export async function subscribeToProductEvents(): Promise<void> {
  try {
    // Connect to RabbitMQ
    const conn = await amqp.connect("amqp://localhost:5672");
    const channel = await conn.createChannel();

    // Define the same exchange name as in the publisher
    const exchange = "product.events";

    // Assert the exchange exists
    await channel.assertExchange(exchange, "fanout", { durable: false });

    // Create a queue for this subscriber
    const queue = await channel.assertQueue("", { exclusive: true });

    // Bind the queue to the exchange
    await channel.bindQueue(queue.queue, exchange, "");

    console.log("Waiting for product events...");

    // Consume messages from the queue
    await channel.consume(
      queue.queue,
      (message) => {
        if (message !== null) {
          try {
            // Parse the message content
            const event: ProductEvent = JSON.parse(message.content.toString());

            // Log the received event
            console.log("Received event:", event);

            // Acknowledge the message
            channel.ack(message);
          } catch (error) {
            console.error("Error processing message:", error);
          }
        }
      },
      { noAck: false } // Manual acknowledgment
    );

    // Handle connection close
    conn.on("close", () => {
      console.log("RabbitMQ connection closed");
    });

    conn.on("error", (err) => {
      console.error("RabbitMQ connection error:", err);
    });
  } catch (err) {
    console.error("Error subscribing to product events:", err);
  }
}

// Start the subscriber when your service initializes
subscribeToProductEvents();
