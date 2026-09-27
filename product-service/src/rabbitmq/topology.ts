import type { Channel } from "amqplib";

/**
 * Queue topology with bounded retry and a terminal dead-letter queue.
 *
 *            publish
 *               |
 *        [ exchange ] --routingKey--> [ queue ]
 *                                        |  handler threw -> nack(requeue=false)
 *                                        v
 *                                  [ queue.retry ]   (x-message-ttl)
 *                                        |  TTL expires
 *                                        v
 *                                     [ queue ]      (retry)
 *
 *   after maxDeliveries attempts the message is published to [ queue.dead ]
 *   and acked, so it stops consuming capacity but is never silently lost.
 *
 * Both hops use the default exchange ("") with the target queue as the routing
 * key, which routes straight to that queue without extra exchanges.
 */

export type ExchangeType = "fanout" | "direct" | "topic";

export interface EventTopology {
  queue: string;
  retryQueue: string;
  deadQueue: string;
}

export interface AssertTopologyOptions {
  exchange: string;
  exchangeType: ExchangeType;
  routingKey: string;
  queue: string;
  retryDelayMs: number;
}

export async function assertEventTopology(
  channel: Channel,
  options: AssertTopologyOptions
): Promise<EventTopology> {
  const { exchange, exchangeType, routingKey, queue, retryDelayMs } = options;

  const retryQueue = `${queue}.retry`;
  const deadQueue = `${queue}.dead`;

  await channel.assertExchange(exchange, exchangeType, { durable: true });

  // Terminal dead-letter queue: nothing is dead-lettered out of here.
  await channel.assertQueue(deadQueue, { durable: true });

  // Parking queue. Messages sit here for retryDelayMs then return to the main
  // queue via the default exchange.
  await channel.assertQueue(retryQueue, {
    durable: true,
    arguments: {
      "x-message-ttl": retryDelayMs,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": queue,
    },
  });

  // Main queue. A rejected message is dead-lettered into the retry queue.
  await channel.assertQueue(queue, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": retryQueue,
    },
  });

  await channel.bindQueue(queue, exchange, routingKey);

  return { queue, retryQueue, deadQueue };
}

/**
 * Which delivery attempt this is, counted from the broker's own `x-death`
 * bookkeeping. First delivery is 1.
 */
export function deliveryAttempt(headers: unknown): number {
  const deaths = (headers as { "x-death"?: unknown })?.["x-death"];
  if (!Array.isArray(deaths)) return 1;

  let highest = 0;
  for (const death of deaths) {
    const count = (death as { count?: unknown })?.count;
    if (typeof count === "number" && count > highest) highest = count;
  }
  return highest + 1;
}
