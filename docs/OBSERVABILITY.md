# Observability

How to find out what EDOMS is doing. Everything here lives in
`packages/shared-observability` and is wired into all five services.

An event-driven system is hard to debug for a specific reason: a single order
touches five processes, and nothing in the request that started it is present
by the time payment runs. Three things close that gap, and they are meant to be
used together.

| Question | Use |
|---|---|
| Which log lines belong to this one order? | `correlationId` |
| Where did the four seconds go? | A trace |
| Is anything broken right now, across all orders? | Metrics |

---

## 1. correlationId

One id per business transaction, minted when the transaction starts and copied
onto every event it causes, across every service. Phase 2 put it on the wire;
Phase 6 put it in the logs.

### Where it comes from

- **An HTTP request.** `correlationMiddleware` honours an inbound
  `x-correlation-id` header, so a caller that is already mid-transaction stays
  in it. With no header, a new id is minted and that request becomes the start
  of the trace. Either way it is echoed back on the response:

  ```bash
  curl -i -H "x-correlation-id: my-trace-1" http://localhost:5003/api/v1/order/1
  ```

- **A consumed event.** The subscriber reads it from the envelope and attaches
  it before the handler runs.

- **The outbox relay.** Each row publishes under the correlationId stored with
  it, so the relay hop is followable too.

### Why call sites never mention it

The context is held in an `AsyncLocalStorage` store and merged in by the logger.
Threading it through every function signature would have meant touching every
handler, service function and helper; ambient means a plain
`logger.error("Order not found")` comes out carrying the id anyway:

```
error  Order with ID 999999 not found
       {"correlationId":"...","eventType":"inventory.reservation.failed",
        "queue":"order-service.reservation-failed","attempt":1}
```

Add fields to the work in progress with `addContext({ orderId })`; every line
below it picks them up.

### Following one order

```bash
npm run dev 2>&1 | grep <correlationId>
```

In the pretty dev format the first 8 characters appear as a `[1c47bb8e]`
prefix, which is enough to eyeball that two lines belong together.

---

## 2. Logs

One logger for all five services, `createLogger({ service })`.

| Variable | Default | Effect |
|---|---|---|
| `LOG_LEVEL` | `debug`, or `info` when `NODE_ENV=production` | Minimum level. |
| `LOG_FORMAT` | pretty, or `json` when `NODE_ENV=production` | `json` forces machine-readable output. |

Every line carries `service`, `env`, `timestamp`, `level`, `message`, plus
whatever context is in scope (`correlationId`, `causationId`, `eventType`,
`queue`, `messageId`, `attempt`, `requestId`, `traceId`, `spanId`).

Two winston behaviours are corrected in the shared logger, because both silently
produce the wrong thing:

- `logger.error("msg", err)` — winston only unwraps an `Error` passed *first*;
  in meta it stringifies to `{}` and the stack is lost at exactly the moment you
  need it. It is promoted to an `err` field instead.
- `logger.error("msg", someString)` — winston does `Object.assign(info, value)`
  per extra argument, so a string is spread one character per key
  (`{"0":"E","1":"C",...}`). Primitives are appended to the message instead.

Objects still merge as meta, so `logger.info("published", { eventId })` works as
expected. One caveat: **a meta key called `message` overwrites the line's own
message.** Use `reason` or similar.

---

## 3. Metrics

Prometheus exposition on `GET /metrics` for every service.

```bash
curl -s http://localhost:5003/metrics | grep ^edoms_
```

| Metric | Type | Labels | Reads as |
|---|---|---|---|
| `edoms_events_published_total` | counter | `event_type`, `exchange` | Events the broker confirmed. Counted after the confirm, not after `channel.publish()` returns — publish only buffers. |
| `edoms_events_consumed_total` | counter | `event_type`, `queue`, `outcome` | `outcome` is `ack`, `retried`, `dead-lettered` or `contract-violation`. |
| `edoms_event_handler_duration_seconds` | histogram | `event_type`, `queue`, `outcome` | Wall time inside a handler. |
| `edoms_outbox_pending_rows` | gauge | — | Written but not yet published. Sustained growth means the relay is losing ground. |
| `edoms_outbox_failed_rows` | gauge | — | Exhausted retries. **Every one is a committed change whose event never got out.** |
| `edoms_queue_depth` | gauge | `queue`, `kind` | `kind` is `work`, `retry` or `dead`. |
| `edoms_queue_consumers` | gauge | `queue` | Zero on a work queue means nothing is draining it. |
| `edoms_http_request_duration_seconds` | histogram | `method`, `route`, `status` | Server latency. Unmatched routes collapse to `unmatched` so a 404 scan cannot explode cardinality. |

Plus the default Node process metrics (heap, event-loop lag, GC).

Counters and histograms only appear once they have observed something — an
absent `edoms_events_consumed_total` means nothing has been consumed yet, not
that the metric is missing.

### The two that mean "wake someone up"

`edoms_outbox_failed_rows > 0` and `edoms_queue_depth{kind="dead"} > 0`. Both
are durable, invisible failures: the work stopped, nothing retries it, and no
request is failing to tell you.

The queue monitor samples every 15s (`QUEUE_MONITOR_POLL_MS`) and logs a
structured alert the first time a dead-letter queue is non-empty:

```
error  DEAD LETTER QUEUE NOT EMPTY: order-service.reservation-failed.dead holds 1 message(s)...
       {"queue":"...","depth":1,"alert":"dlq_not_empty"}
```

It alerts once per queue and re-arms when the queue drains, so a stuck message
does not reprint every 15 seconds. Alert on `alert="dlq_not_empty"` in the log
stream, or on the gauge.

---

## 4. Health and readiness

| Endpoint | Answers | On failure |
|---|---|---|
| `GET /health` | Is the process alive? | Never fails on a dependency. |
| `GET /ready` | Can this instance serve traffic? | `503` + the failing dependency names. |

`/health` deliberately checks nothing external. An orchestrator restarts a
container that fails liveness, and restarting because Postgres is down turns one
outage into a crash loop.

`/ready` checks Postgres, RabbitMQ and Redis, each with its own timeout (2s
default) so a hung TCP connect reports "down" rather than leaving the probe
open. **Redis is non-critical**: it is a cache here, so losing it makes a
service slower, not wrong, and failing readiness on it would pull healthy
instances out of the load balancer.

```json
{
  "status": "ready",
  "service": "order-service",
  "checks": {
    "postgres": { "status": "up", "durationMs": 2 },
    "rabbitmq": { "status": "up", "durationMs": 1 },
    "redis":    { "status": "down", "durationMs": 576, "error": "Reached the max retries per request limit..." }
  }
}
```

That is a real response with Redis genuinely stopped: `200 ready`, Redis
reported down.

---

## 5. Traces

Off unless configured.

| Variable | Effect |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Send spans to a collector, e.g. `http://localhost:4318`. |
| `OTEL_TRACES_CONSOLE=1` | Print spans to stdout. For local inspection. |
| `OTEL_DIAG=1` | OpenTelemetry's own diagnostics, when tracing itself misbehaves. |

```bash
OTEL_TRACES_CONSOLE=1 npm run dev
```

Instrumented: `http`, `express`, `amqplib`, `pg`, `ioredis`. The probes are
excluded — they are polled constantly and say nothing.

The amqplib instrumentation is the reason this is worth having. It injects
trace context into message headers on publish and reads it back on consume, so
a span started by `POST /createorder` continues inside inventory-service's
reservation handler. Verified: consuming one event produced
`order-service.reservation-failed process` as the root span with the handler's
`pg.query:SELECT` as its child, under the same `traceId` that the log lines for
that event carried.

Each service has a one-line `src/tracing.ts` that **must stay the first import
in `index.ts`**. The instrumentations patch modules as they are required, and
CommonJS executes requires in import order — move it below `express` and every
hop silently produces no spans.

There is no collector in the repo yet; Phase 7's docker-compose is where one
belongs.

---

## Gotchas

- **`NODE_ENV` must be exactly `production`** for file logging and `info` level
  to engage. A value like `production npm run dev` (a shell command pasted into
  a `.env`) leaves every production branch off, silently.
- Counters with no observations are absent from `/metrics`, not zero.
- A meta key named `message` overwrites the log message. Use `reason`.
- `/metrics` is unauthenticated and process-local. Each replica reports only its
  own numbers; aggregate at the scraper.
