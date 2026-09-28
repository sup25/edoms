import fs from "fs";
import { createLogger as createWinstonLogger, format, transports } from "winston";
import type { Logger } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { getContext } from "./context";
import { activeTraceIds } from "./traceIds";

export interface LoggerOptions {
  /** Service name, stamped on every line so one aggregated stream stays separable. */
  service: string;
  level?: string;
  logDir?: string;
  /**
   * Human-readable console output instead of JSON. Defaults to on outside
   * production - JSON is for log shippers, not for a developer reading a
   * terminal.
   */
  pretty?: boolean;
}

const SPLAT = Symbol.for("splat") as unknown as symbol;
/** printf-style tokens winston interpolates itself; leave those args alone. */
const PLACEHOLDER = /%[sdifjoO%]/;

/**
 * Makes winston handle the two argument shapes this repo actually uses.
 *
 * Both are cases where stock winston quietly produces the wrong thing:
 *
 * 1. `logger.error("msg", err)` - `format.errors({ stack: true })` only
 *    unwraps an Error passed FIRST. In meta it stringifies to `{}`, so the
 *    stack is dropped at exactly the moment it matters. It is promoted to an
 *    `err` field here instead.
 *
 * 2. `logger.error("msg", someString)` - winston's splat format does
 *    `Object.assign(info, value)` on each extra argument. Assigning a STRING
 *    spreads it one character per key, so `"ECONNREFUSED"` logs as
 *    `{"0":"E","1":"C",...}`. Primitives are appended to the message instead.
 *
 * Object arguments are left in place, so `logger.info("msg", { orderId })`
 * still merges as meta the usual way.
 */
const normaliseArgs = format((info) => {
  const record = info as Record<string | symbol, unknown>;

  const promote = (value: unknown): boolean => {
    if (!(value instanceof Error)) return false;
    info.err = {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(("detail" in value) ? { detail: (value as { detail?: unknown }).detail } : {}),
    };
    return true;
  };

  promote(record.error);
  if (record.error instanceof Error) delete record.error;

  const splat = record[SPLAT] as unknown[] | undefined;
  if (!Array.isArray(splat) || splat.length === 0) return info;

  // A message with %s and friends is winston's to interpolate, not ours.
  if (typeof info.message === "string" && PLACEHOLDER.test(info.message)) {
    splat.forEach(promote);
    return info;
  }

  const kept: unknown[] = [];
  const appended: string[] = [];
  for (const value of splat) {
    if (promote(value)) continue;
    if (value !== null && typeof value === "object") {
      kept.push(value);
      continue;
    }
    appended.push(String(value));
  }

  if (appended.length > 0) {
    info.message = `${String(info.message)} ${appended.join(" ")}`.trim();
  }
  record[SPLAT] = kept;

  return info;
});

/**
 * Merges the ambient request/event context into every line, plus the ids of
 * the span in progress when tracing is on - so a log line leads to its trace
 * and back again.
 */
const withContext = format((info) => {
  const context = getContext();
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (info[key] === undefined) info[key] = value;
    }
  }

  const { traceId, spanId } = activeTraceIds();
  if (traceId && info.traceId === undefined) info.traceId = traceId;
  if (spanId && info.spanId === undefined) info.spanId = spanId;

  return info;
});

const prettyLine = format.printf((info) => {
  const { timestamp, level, message, service, correlationId, err, ...rest } = info as
    Record<string, unknown> & { timestamp?: string; level: string; message: unknown };

  // Short prefix of the correlationId: enough to eyeball that two lines belong
  // together, without a UUID on every line drowning the message.
  const trace = typeof correlationId === "string" ? ` [${correlationId.slice(0, 8)}]` : "";
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  const stack =
    err && typeof err === "object" && "stack" in (err as object)
      ? `\n${(err as { stack?: string }).stack}`
      : "";

  return `${timestamp} ${level}${trace} ${String(message)}${extra}${stack}`;
});

export function createLogger(options: LoggerOptions): Logger {
  const {
    service,
    logDir = "logs",
    level = process.env.LOG_LEVEL ??
      (process.env.NODE_ENV === "production" ? "info" : "debug"),
    pretty = process.env.LOG_FORMAT
      ? process.env.LOG_FORMAT !== "json"
      : process.env.NODE_ENV !== "production",
  } = options;

  const base = format.combine(
    format.timestamp(),
    normaliseArgs(),
    withContext(),
    format.splat()
  );

  const logger = createWinstonLogger({
    level,
    defaultMeta: { service, env: process.env.NODE_ENV ?? "development" },
    format: format.combine(base, format.json()),
    transports: [
      new transports.Console({
        format: pretty
          ? format.combine(base, format.colorize(), prettyLine)
          : format.combine(base, format.json()),
      }),
    ],
  });

  if (process.env.NODE_ENV === "production") {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    for (const [filename, fileLevel] of [
      [`${logDir}/error-%DATE%.log`, "error"],
      [`${logDir}/combined-%DATE%.log`, undefined],
    ] as const) {
      logger.add(
        new DailyRotateFile({
          filename,
          datePattern: "YYYY-MM-DD",
          ...(fileLevel ? { level: fileLevel } : {}),
          zippedArchive: true,
          maxSize: "20m",
          maxFiles: "14d",
        })
      );
    }
  }

  return logger;
}
