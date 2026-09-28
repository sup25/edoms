import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

/**
 * The fields that identify "which piece of work am I in the middle of".
 *
 * Phase 5 already made one correlationId flow the whole saga on the wire - the
 * envelope carries it from `order.created` all the way to `order.confirmed`.
 * What was missing is that nothing put it in the LOGS, so reconstructing a
 * failed order still meant reading five services and guessing which lines
 * belonged together.
 *
 * Threading it through every function signature would have meant touching
 * every handler, every service call and every helper. An AsyncLocalStorage
 * store keeps it ambient instead: the entry points (an HTTP request, a
 * consumed event, an outbox relay tick) establish the context once, and the
 * logger reads it on every line underneath - including inside library code
 * that knows nothing about correlationIds.
 */
export interface ObservabilityContext {
  /** The business transaction id. Minted at the entry point, copied onto every event it causes. */
  correlationId: string;
  /** The eventId being reacted to, when this work was started by an event. */
  causationId?: string;
  /** Per-HTTP-request id. Distinct from correlationId: one transaction can span many requests. */
  requestId?: string;
  /** The event type being handled, when inside a consumer. */
  eventType?: string;
  /** The AMQP messageId, so a redelivery can be tied to its original. */
  messageId?: string;
  /** The consuming queue. */
  queue?: string;
  /** Authenticated user, when known. */
  userId?: string | number;
  /** Anything else worth carrying; merged into every log line. */
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<ObservabilityContext>();

/** The context for the work in progress, or undefined outside any entry point. */
export function getContext(): ObservabilityContext | undefined {
  return storage.getStore();
}

/** The current correlationId, or undefined if nothing has established one. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Runs `fn` with `context` attached to it and everything it awaits.
 *
 * A missing correlationId means nobody started a trace, so one is started
 * here rather than leaving the work unlinkable - the same rule
 * `buildEnvelope` applies on the publish side.
 */
export function runWithContext<T>(
  context: Partial<ObservabilityContext>,
  fn: () => T
): T {
  const resolved: ObservabilityContext = {
    ...context,
    correlationId: context.correlationId ?? randomUUID(),
  };
  return storage.run(resolved, fn);
}

/**
 * Adds fields to the context already in progress.
 *
 * Mutates in place, so it affects the current run only and cannot leak into a
 * sibling operation. A no-op outside any context, which keeps callers from
 * having to check.
 */
export function addContext(fields: Partial<ObservabilityContext>): void {
  const store = storage.getStore();
  if (!store) return;
  Object.assign(store, fields);
}

/** A fresh correlationId, for entry points that are not continuing an existing transaction. */
export function newCorrelationId(): string {
  return randomUUID();
}
