const DEFAULT_BROKER_URL = "amqp://localhost:5672";

export const BrokerConfig = {
  amqpUrl: process.env.BROKER_URL || DEFAULT_BROKER_URL,
};
