import amqp from "amqplib";

let channel: amqp.Channel | null = null;

async function connectRabbitMQ(): Promise<amqp.Channel> {
  if (channel) return channel;

  const connection = await amqp.connect("amqp://localhost:5672");
  channel = await connection.createChannel();
  await channel.assertExchange("inventory_exchange", "topic", {
    durable: true,
  });
  return channel;
}

export async function publishEvent(eventName: string, data: any) {
  const channel = await connectRabbitMQ();

  const message = JSON.stringify({
    event: eventName,
    data,
    timestamp: new Date().toISOString(),
  });

  channel.publish("inventory_exchange", eventName, Buffer.from(message));
  console.log(
    `Published event: ${eventName} with data: ${JSON.stringify(data)}`
  );
}
