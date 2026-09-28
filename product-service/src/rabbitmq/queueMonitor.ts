import type { EventTopology } from "./topology";
import { queueConsumers, queueDepth } from "@edoms/shared-observability";
import { createConsumerChannel } from "./connection";
import logger from "../utils/logger";

/**
 * Watches the queues this service consumes.
 *
 * Phase 1 gave every queue a retry queue and a terminal dead-letter queue, so
 * a poisoned message stops consuming capacity instead of being lost. But a DLQ
 * nobody looks at is the same as dropping the message - the failure is durable
 * and invisible. This turns depth into a metric and a log line.
 */

const registry = new Map<string, EventTopology>();

export function registerQueue(topology: EventTopology): void {
  registry.set(topology.queue, topology);
}

const POLL_MS = Number(process.env.QUEUE_MONITOR_POLL_MS || 15_000);

let timer: NodeJS.Timeout | null = null;
let running = false;
/** Dead queues already reported, so a stuck message logs once, not every poll. */
const alerted = new Set<string>();

export async function sampleQueues(): Promise<void> {
  if (registry.size === 0) return;

  // checkQueue throws and KILLS the channel when a queue is missing, so the
  // sampler uses a channel of its own - a mis-sample must not take a consumer
  // channel down with it.
  const channel = await createConsumerChannel();
  channel.on("error", () => undefined);

  try {
    for (const topology of registry.values()) {
      for (const [queue, kind] of [
        [topology.queue, "work"],
        [topology.retryQueue, "retry"],
        [topology.deadQueue, "dead"],
      ] as const) {
        try {
          const status = await channel.checkQueue(queue);
          queueDepth.labels(queue, kind).set(status.messageCount);
          if (kind === "work") queueConsumers.labels(queue).set(status.consumerCount);

          if (kind === "dead") {
            if (status.messageCount > 0 && !alerted.has(queue)) {
              // The alert. Anything here failed every retry and needs a human.
              logger.error(
                `DEAD LETTER QUEUE NOT EMPTY: ${queue} holds ${status.messageCount} message(s). ` +
                  `Each one failed every retry and will not be delivered without intervention.`,
                { queue, depth: status.messageCount, alert: "dlq_not_empty" }
              );
              alerted.add(queue);
            } else if (status.messageCount === 0) {
              alerted.delete(queue);
            }
          }
        } catch {
          // A queue that does not exist yet is not an error worth logging on a
          // 15s loop; the gauge simply stays at its last value.
        }
      }
    }
  } finally {
    await channel.close().catch(() => undefined);
  }
}

export function startQueueMonitor(): void {
  if (running) return;
  running = true;

  const tick = async (): Promise<void> => {
    if (!running) return;
    try {
      await sampleQueues();
    } catch (error) {
      logger.warn("Queue monitor sample failed", error);
    } finally {
      if (running) timer = setTimeout(() => void tick(), POLL_MS).unref?.() ?? null;
    }
  };

  timer = setTimeout(() => void tick(), POLL_MS).unref?.() ?? null;
  logger.info(`Queue monitor started (poll ${POLL_MS}ms)`);
}

export function stopQueueMonitor(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
