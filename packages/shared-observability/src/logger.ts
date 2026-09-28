import fs from "fs";
import { createLogger as createWinstonLogger, format, transports } from "winston";
import type { Logger } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { getContext } from "./context";

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

/**
 * Winston's `format.errors({ stack: true })` only unwraps an Error passed as
 * the FIRST argument. Every existing call site in this repo is
 * `logger.error("something failed", error)`, where the Error lands in meta and
 * winston stringifies it to `{}` - the stack is silently dropped, which is the
 * exact moment you most need it.
 */
const normaliseErrors = format((info) => {
  const splat = (info as Record<symbol, unknown>)[
    Symbol.for("splat") as unknown as symbol
  ] as unknown[] | undefined;

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

  if (Array.isArray(splat)) splat.forEach(promote);
  promote((info as { error?: unknown }).error);
  if (info.error instanceof Error) delete info.error;

  return info;
});

/** Merges the ambient request/event context into every line. */
const withContext = format((info) => {
  const context = getContext();
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (info[key] === undefined) info[key] = value;
    }
  }
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
    normaliseErrors(),
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
