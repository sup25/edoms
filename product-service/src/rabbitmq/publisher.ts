import amqp from "amqplib";

export async function publishEvent(
  exchange: string,
  action: string,
  payload: any
): Promise<void> {
  try {
    const event = { action, payload };

    const conn = await amqp.connect("amqp://localhost:5672");
    const channel = await conn.createChannel();
    await channel.assertExchange(exchange, "fanout", { durable: false });
    // Publish the event with a flexible payload
    channel.publish(exchange, "", Buffer.from(JSON.stringify(event)));
    console.log(`📢 Event published:`, event);
  } catch (err) {
    console.error("❌ Error publishing event to RabbitMQ:", err);
  }
}
