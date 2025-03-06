import amqp from "amqplib";

export async function subscribeToEvents(
  exchange: string,
  callback: (msg: any) => Promise<void>
): Promise<void> {
  try {
    const conn = await amqp.connect("amqp://localhost:5672");
    const channel = await conn.createChannel();
    await channel.assertExchange(exchange, "fanout", { durable: false });
    const q = await channel.assertQueue("", { exclusive: true });
    channel.bindQueue(q.queue, exchange, "");

    console.log(`Waiting for events on ${exchange}...`);
    channel.consume(
      q.queue,
      async (msg) => {
        if (msg) {
          const event = JSON.parse(msg.content.toString());
          await callback(event);
        }
      },
      { noAck: true }
    );
  } catch (err) {
    console.error("Error subscribing to RabbitMQ:", err);
  }
}
