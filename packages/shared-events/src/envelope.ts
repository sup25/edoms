import { randomUUID } from "crypto";
import { z } from "zod";
import { EventType, canonicalEventType } from "./events";

/**
 * The envelope every event travels in.
 *
 * `correlationId` is the important one: it is minted when a business
 * transaction starts (an HTTP request creating an order) and copied onto every
 * event that transaction causes, across all five services. Without it an
 * asynchronous flow cannot be reconstructed from logs - you can see that seven
 * events happened, but not that they were the same order.
 *
 * `causationId` is the eventId of the event being reacted to, so the chain can
 * be walked one hop at a time.
 */
export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: EventType;
  eventVersion: number;
  occurredAt: string;
  producer: string;
  correlationId: string;
  causationId?: string;
  payload: T;
}

export const envelopeSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  occurredAt: z.string().min(1),
  producer: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().optional(),
  payload: z.unknown(),
});

export interface BuildEnvelopeOptions {
  producer: string;
  correlationId?: string;
  causationId?: string;
  eventVersion?: number;
}

export function buildEnvelope<T>(
  eventType: EventType,
  payload: T,
  options: BuildEnvelopeOptions
): EventEnvelope<T> {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: options.eventVersion ?? 1,
    occurredAt: new Date().toISOString(),
    producer: options.producer,
    // A missing correlationId means nobody started a trace, so start one here
    // rather than leaving the chain unlinkable.
    correlationId: options.correlationId ?? randomUUID(),
    ...(options.causationId ? { causationId: options.causationId } : {}),
    payload,
  };
}

export class EventContractError extends Error {
  constructor(message: string, public readonly detail?: unknown) {
    super(message);
    this.name = "EventContractError";
  }
}

/**
 * Reads a message off the wire into a validated envelope.
 *
 * Also accepts the pre-Phase-2 shape `{ event, data }` so messages already
 * sitting in a durable queue are not stranded. Those are upgraded in place and
 * given a fresh correlationId, since the old format had none.
 */
export function parseEnvelope(raw: string): EventEnvelope {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new EventContractError("message is not valid JSON");
  }

  const legacy = json as { event?: unknown; data?: unknown };
  if (typeof legacy?.event === "string" && !("eventType" in (json as object))) {
    const canonical = canonicalEventType(legacy.event);
    if (!canonical) {
      throw new EventContractError(`unknown legacy event name: ${legacy.event}`);
    }
    return {
      eventId: randomUUID(),
      eventType: canonical,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: "legacy",
      correlationId: randomUUID(),
      payload: legacy.data,
    };
  }

  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new EventContractError(
      "message does not match the event envelope",
      parsed.error.flatten()
    );
  }

  const canonical = canonicalEventType(parsed.data.eventType);
  if (!canonical) {
    throw new EventContractError(`unknown eventType: ${parsed.data.eventType}`);
  }

  return { ...parsed.data, eventType: canonical } as EventEnvelope;
}
