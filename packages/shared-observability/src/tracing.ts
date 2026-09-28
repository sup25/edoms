import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { AmqplibInstrumentation } from "@opentelemetry/instrumentation-amqplib";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";

export interface TracingOptions {
  service: string;
  version?: string;
}

/**
 * Distributed tracing across the HTTP and AMQP hops.
 *
 * The correlationId answers "which lines belong to this order"; a trace
 * answers "where did the 4 seconds go". They are complementary, and
 * `createLogger` stamps traceId/spanId on every line so one leads to the
 * other.
 *
 * The amqplib instrumentation is the reason this is worth having at all: it
 * injects trace context into message headers on publish and picks it back up
 * on consume, so a span started by `POST /createorder` in order-service
 * continues inside inventory-service's reservation handler. That linkage is
 * the thing five separate service logs cannot give you.
 *
 * OFF unless configured. It is opt-in for two reasons: the instrumentations
 * monkey-patch http, express, amqplib, pg and ioredis at require time, and
 * without a collector to receive them the spans have nowhere to go. Phase 7's
 * docker-compose is what makes a collector available; until then
 * OTEL_TRACES_CONSOLE=1 prints spans locally, which is enough to see the
 * linkage work.
 *
 * Must run BEFORE the modules it patches are required - see tracing-entry.ts.
 */

let sdk: NodeSDK | undefined;

export function startTracing(options: TracingOptions): NodeSDK | undefined {
  if (sdk) return sdk;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const toConsole = process.env.OTEL_TRACES_CONSOLE === "1";
  if (!endpoint && !toConsole) return undefined;

  if (process.env.OTEL_DIAG === "1") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.service,
      [ATTR_SERVICE_VERSION]: options.version ?? "1.0.0",
    }),
    ...(endpoint
      ? { traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) }
      : {
          // SimpleSpanProcessor, not Batch: for eyeballing spans locally you
          // want them printed when they end, not up to 5s later.
          spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
        }),
    instrumentations: [
      new HttpInstrumentation({
        // The probes are polled constantly and say nothing useful.
        ignoreIncomingRequestHook: (request) => {
          const url = request.url ?? "";
          return ["/health", "/ready", "/metrics"].some((path) => url.startsWith(path));
        },
      }),
      new ExpressInstrumentation(),
      new AmqplibInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });

  sdk.start();
  return sdk;
}

export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}

export { activeTraceIds } from "./traceIds";
