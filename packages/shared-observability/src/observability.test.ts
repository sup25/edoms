import { Writable } from "stream";
import type { Logger } from "winston";
import { transports } from "winston";
import {
  addContext,
  getContext,
  getCorrelationId,
  runWithContext,
} from "./context";
import { createLogger } from "./logger";
import { healthHandler, readyHandler } from "./health";
import { CORRELATION_HEADER, correlationMiddleware } from "./http";

const noop = (() => undefined) as never;

/** Collects the JSON lines a logger writes, so assertions can read the fields. */
function captureLogger(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const written: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk.toString());
      callback();
    },
  });

  const logger = createLogger({ service: "test-service", pretty: false });
  logger.clear();
  logger.add(new transports.Stream({ stream: sink }));

  return {
    logger,
    lines: () =>
      written
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function fakeReqRes(headers: Record<string, string> = {}) {
  const set: Record<string, string> = {};
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
  } as never;
  const res = {
    setHeader: (name: string, value: string) => {
      set[name] = value;
    },
    status(code: number) {
      (this as Record<string, unknown>).statusCode = code;
      return this;
    },
    json(body: unknown) {
      (this as Record<string, unknown>).body = body;
      return this;
    },
  } as Record<string, unknown>;
  return { req, res, set };
}

describe("context", () => {
  it("makes the correlationId visible to everything inside the run", async () => {
    await runWithContext({ correlationId: "corr-1" }, async () => {
      expect(getCorrelationId()).toBe("corr-1");
      // The point of AsyncLocalStorage over a plain variable: it survives an await.
      await new Promise((resolve) => setImmediate(resolve));
      expect(getCorrelationId()).toBe("corr-1");
    });
  });

  it("mints a correlationId when the caller has none", () => {
    runWithContext({}, () => {
      expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it("keeps sibling runs from seeing each other context", async () => {
    const seen: (string | undefined)[] = [];
    await Promise.all([
      runWithContext({ correlationId: "a" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(getCorrelationId());
      }),
      runWithContext({ correlationId: "b" }, async () => {
        seen.push(getCorrelationId());
      }),
    ]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("reports no context outside a run", () => {
    expect(getContext()).toBeUndefined();
  });

  it("addContext is a no-op outside a run rather than throwing", () => {
    expect(() => addContext({ userId: 1 })).not.toThrow();
  });

  it("addContext enriches the run in progress", () => {
    runWithContext({ correlationId: "c" }, () => {
      addContext({ userId: 42 });
      expect(getContext()?.userId).toBe(42);
    });
  });
});

describe("logger", () => {
  it("stamps the service on every line", () => {
    const { logger, lines } = captureLogger();
    logger.info("hello");
    expect(lines()[0]).toMatchObject({ service: "test-service", message: "hello" });
  });

  it("merges the ambient context into the line without the caller passing it", () => {
    const { logger, lines } = captureLogger();
    runWithContext({ correlationId: "corr-9", eventType: "order.created" }, () => {
      logger.info("reserving stock");
    });
    expect(lines()[0]).toMatchObject({
      correlationId: "corr-9",
      eventType: "order.created",
    });
  });

  it("lets an explicit field win over the ambient one", () => {
    const { logger, lines } = captureLogger();
    runWithContext({ correlationId: "ambient" }, () => {
      logger.info("explicit wins", { correlationId: "explicit" });
    });
    expect(lines()[0].correlationId).toBe("explicit");
  });

  it("keeps the stack of an Error passed as the second argument", () => {
    // This is the pattern every existing call site uses. Plain winston
    // stringifies it to {} and loses the stack entirely.
    const { logger, lines } = captureLogger();
    logger.error("it broke", new Error("boom"));
    const err = lines()[0].err as { message: string; stack: string };
    expect(err.message).toBe("boom");
    expect(err.stack).toContain("boom");
  });

  it("appends a string argument instead of spreading it character by character", () => {
    // Stock winston does Object.assign(info, "ECONNREFUSED"), which logs
    // {"0":"E","1":"C",...}. order-service/utils/redis.ts hits this on every
    // Redis error.
    const { logger, lines } = captureLogger();
    logger.error("Redis error:", "connect ECONNREFUSED 127.0.0.1:6379");
    const line = lines()[0];
    expect(line.message).toBe("Redis error: connect ECONNREFUSED 127.0.0.1:6379");
    expect(line["0"]).toBeUndefined();
  });

  it("still merges an object argument as meta", () => {
    const { logger, lines } = captureLogger();
    logger.info("published", { eventId: "e-1", exchange: "order.events" });
    expect(lines()[0]).toMatchObject({ eventId: "e-1", exchange: "order.events" });
  });

  it("leaves printf-style interpolation to winston", () => {
    const { logger, lines } = captureLogger();
    logger.info("retry %d of %d", 2, 5);
    expect(lines()[0].message).toBe("retry 2 of 5");
  });
});

describe("health", () => {
  it("reports liveness without touching a dependency", () => {
    const { req, res } = fakeReqRes();
    healthHandler("order-service")(req, res as never, noop);
    expect((res.body as { status: string }).status).toBe("ok");
  });

  it("is ready when every check passes", async () => {
    const { req, res } = fakeReqRes();
    readyHandler("order-service", [{ name: "db", check: async () => true }])(
      req,
      res as never,
      noop
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(200);
    expect((res.body as { status: string }).status).toBe("ready");
  });

  it("returns 503 and names the failing dependency", async () => {
    const { req, res } = fakeReqRes();
    readyHandler("order-service", [
      {
        name: "db",
        check: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
    ])(req, res as never, noop);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(503);
    expect((res.body as { failing: string[] }).failing).toEqual(["db"]);
  });

  it("stays ready when only a non-critical dependency is down", async () => {
    // Redis is a cache here: losing it makes the service slower, not wrong.
    const { req, res } = fakeReqRes();
    readyHandler("order-service", [
      { name: "db", check: async () => true },
      {
        name: "redis",
        critical: false,
        check: async () => {
          throw new Error("down");
        },
      },
    ])(req, res as never, noop);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(200);
    const checks = (res.body as { checks: Record<string, { status: string }> }).checks;
    expect(checks.redis.status).toBe("down");
  });

  it("fails a check that hangs instead of waiting forever", async () => {
    const { req, res } = fakeReqRes();
    readyHandler("order-service", [
      { name: "db", timeoutMs: 20, check: () => new Promise(() => undefined) },
    ])(req, res as never, noop);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(res.statusCode).toBe(503);
    const checks = (res.body as { checks: Record<string, { error: string }> }).checks;
    expect(checks.db.error).toContain("timed out");
  });
});

describe("correlationMiddleware", () => {
  it("honours an inbound correlationId so a caller trace continues", (done) => {
    const { req, res, set } = fakeReqRes({ [CORRELATION_HEADER]: "from-caller" });
    correlationMiddleware()(req, res as never, () => {
      expect(getCorrelationId()).toBe("from-caller");
      expect(set[CORRELATION_HEADER]).toBe("from-caller");
      done();
    });
  });

  it("mints one when there is no inbound header", (done) => {
    const { req, res, set } = fakeReqRes();
    correlationMiddleware()(req, res as never, () => {
      expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
      expect(set[CORRELATION_HEADER]).toBe(getCorrelationId());
      done();
    });
  });

  it("ignores a blank header rather than trusting it", (done) => {
    const { req, res } = fakeReqRes({ [CORRELATION_HEADER]: "   " });
    correlationMiddleware()(req, res as never, () => {
      expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
      done();
    });
  });
});
