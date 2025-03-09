import amqp from "amqplib";

export async function publishEvent(
  exchange: string,
  action: string,
  product: any
): Promise<void> {
  try {
    // Convert the Sequelize instance to a plain object
    const productData = product.toJSON();

    // Create the event object with relevant data
    const event = {
      action,
      product: {
        id: productData.id,
        initialStock: productData.initialStock,
      },
    };

    const conn = await amqp.connect("amqp://localhost:5672");
    const channel = await conn.createChannel();
    await channel.assertExchange(exchange, "fanout", { durable: false });

    // Publish the event with the action and the serialized product data
    channel.publish(exchange, "", Buffer.from(JSON.stringify(event)));

    console.log(`Event published:`, event);
  } catch (err) {
    console.error("Error publishing event to RabbitMQ:", err);
  }
}
