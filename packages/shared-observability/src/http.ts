import type { ObsHandler, ObsRequest, ObsResponse, ObsNext } from "./express";
import { randomUUID } from "crypto";
import type { Logger } from "winston";
import { runWithContext } from "./context";
import { httpRequestDuration, metricsContentType, metricsText } from "./metrics";

export const CORRELATION_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Establishes the observability context for an HTTP request.
 *
 * An inbound `x-correlation-id` is honoured so a caller that is already part of
 * a transaction stays part of it; otherwise a new one is minted here, and this
 * request becomes the start of the trace. Either way it is echoed back on the
 * response, so a client (or a smoke test) can quote the id when reporting a
 * problem.
 *
 * Mount this BEFORE the body parser and the routes - anything above it logs
 * without a correlationId.
 */
export function correlationMiddleware(): ObsHandler {
  return (req: ObsRequest, res: ObsResponse, next: ObsNext): void => {
    const inbound = req.header(CORRELATION_HEADER);
    const correlationId = inbound && inbound.trim() ? inbound.trim() : randomUUID();
    const requestId = req.header(REQUEST_ID_HEADER)?.trim() || randomUUID();

    res.setHeader(CORRELATION_HEADER, correlationId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    runWithContext({ correlationId, requestId }, () => next());
  };
}

export interface RequestLoggerOptions {
  logger: Logger;
  /** Paths kept out of the log, so a 1s health poll does not bury real traffic. */
  ignore?: string[];
}

/** Logs one line per completed request and records its latency. */
export function requestLogger(options: RequestLoggerOptions): ObsHandler {
  const { logger, ignore = ["/health", "/ready", "/metrics"] } = options;

  return (req: ObsRequest, res: ObsResponse, next: ObsNext): void => {
    if (ignore.includes(req.path)) return next();
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      // req.route is only populated once a route has matched; the raw path of
      // an unmatched request would give every 404 its own label value and
      // blow up metric cardinality.
      const routePath = req.route?.path;
      const route =
        typeof routePath === "string" ? `${req.baseUrl}${routePath}` : "unmatched";

      httpRequestDuration
        .labels(req.method, route, String(res.statusCode))
        .observe(seconds);

      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
      });
    });

    next();
  };
}

/** `GET /metrics` in Prometheus exposition format. */
export function metricsHandler(): ObsHandler {
  return (_req: ObsRequest, res: ObsResponse): void => {
    void metricsText().then(
      (body) => {
        res.setHeader("Content-Type", metricsContentType);
        res.send(body);
      },
      () => res.status(500).send("# metrics collection failed\n")
    );
  };
}
