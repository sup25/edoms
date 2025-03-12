import amqp from "amqplib";

let channel: amqp.Channel | null = null;

async function connectRabbitMQ(): Promise<amqp.Channel> {
  if (channel) return channel;

  const connection = await amqp.connect("amqp://localhost:5672");
  channel = await connection.createChannel();
  return channel;
}

export async function subscribeToEvent(
  eventName: string,
  callback: (data: any) => void,
  exchange: string
) {
  try {
    const channel = await connectRabbitMQ();
    const queue = `${eventName}_queue`;

    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, eventName);

    channel.consume(
      queue,
      (msg) => {
        if (msg) {
          try {
            const { event, data } = JSON.parse(msg.content.toString());
            console.log(`Received message for event ${event}:`, data);
            callback(data);
            channel.ack(msg);
          } catch (err) {
            console.error("Error parsing message:", err);
            channel.nack(msg, false, true);
          }
        }
      },
      { noAck: false }
    );

    console.log(`Subscribed to event: ${eventName} on ${exchange}`);
  } catch (err) {
    console.error(`Failed to subscribe to event ${eventName}:`, err);
    throw err;
  }
}
