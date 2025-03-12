import amqplib from "amqplib";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const EXCHANGE_NAME = "order_exchange";
const ROUTING_KEY = "order_created";

export const publishOrderEvent = async (order: any) => {
  try {
    const connection = await amqplib.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Assert direct exchange
    await channel.assertExchange(EXCHANGE_NAME, "direct", { durable: true });

    const message = JSON.stringify({ event: "order_created", data: order });

    // Publish with routing key "order_created"
    channel.publish(EXCHANGE_NAME, ROUTING_KEY, Buffer.from(message));

    console.log(" [x] Sent order event:", message);

    setTimeout(() => {
      channel.close();
      connection.close();
    }, 500);
  } catch (error) {
    console.error("Failed to publish order event:", error);
  }
};
