import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * One registry per process. Metric objects are created once and reused -
 * prom-client throws on a duplicate registration, which would otherwise turn a
 * double import into a boot failure.
 */
export const registry = new Registry();

let defaultsStarted = false;

export function initMetrics(service: string): void {
  registry.setDefaultLabels({ service });
  if (!defaultsStarted) {
    collectDefaultMetrics({ register: registry });
    defaultsStarted = true;
  }
}

export const eventsPublished = new Counter({
  name: "edoms_events_published_total",
  help: "Events successfully published to the broker.",
  labelNames: ["event_type", "exchange"] as const,
  registers: [registry],
});

export const eventsConsumed = new Counter({
  name: "edoms_events_consumed_total",
  help: "Events consumed and handled. `outcome` separates a clean ack from a retry or a dead-letter.",
  labelNames: ["event_type", "queue", "outcome"] as const,
  registers: [registry],
});

export const eventHandlerDuration = new Histogram({
  name: "edoms_event_handler_duration_seconds",
  help: "Wall time spent inside an event handler.",
  labelNames: ["event_type", "queue", "outcome"] as const,
  // Handlers here do a DB transaction and sometimes a Stripe call, so the
  // interesting range spans milliseconds to several seconds.
  buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const outboxPending = new Gauge({
  name: "edoms_outbox_pending_rows",
  help: "Outbox rows written but not yet published. Sustained growth means the relay is not keeping up.",
  registers: [registry],
});

export const outboxFailed = new Gauge({
  name: "edoms_outbox_failed_rows",
  help: "Outbox rows that exhausted their retries. Every one of these is an event that never reached the broker.",
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: "edoms_queue_depth",
  help: "Messages ready on a queue. `kind` distinguishes a work queue from its retry and dead-letter queues.",
  labelNames: ["queue", "kind"] as const,
  registers: [registry],
});

export const queueConsumers = new Gauge({
  name: "edoms_queue_consumers",
  help: "Consumers attached to a queue. Zero on a work queue means nothing is draining it.",
  labelNames: ["queue"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "edoms_http_request_duration_seconds",
  help: "HTTP server request latency.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/** The Prometheus exposition text, for a `/metrics` endpoint. */
export async function metricsText(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;
