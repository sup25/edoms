import { trace } from "@opentelemetry/api";

/**
 * Ids of the span in progress, for stamping onto a log line.
 *
 * Lives apart from tracing.ts, and imports only @opentelemetry/api, so the
 * logger does not drag the whole SDK and its five instrumentations into
 * every process that merely wants to log. With no SDK registered the API is a
 * no-op and this returns nothing, which is exactly what should happen when
 * tracing is off.
 */
export function activeTraceIds(): { traceId?: string; spanId?: string } {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const context = span.spanContext();
  return { traceId: context.traceId, spanId: context.spanId };
}
