import { startTracing } from "@edoms/shared-observability";

/**
 * MUST be the first import in index.ts.
 *
 * The instrumentations patch http, express, amqplib, pg and ioredis as
 * they are required. CommonJS executes requires in import order, so if
 * this ran after them there would be nothing left to patch and every hop
 * would silently produce no spans.
 *
 * A no-op unless OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_TRACES_CONSOLE=1 is
 * set.
 */
startTracing({ service: "product-service" });
