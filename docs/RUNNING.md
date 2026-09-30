# Running EDOMS and seeing what it does

EDOMS is five services plus three pieces of infrastructure. The interesting
behaviour is the events moving between them, which is invisible if you only watch
HTTP responses. This guide gets it running and then makes the events visible.

---

## 1. Check what you are missing

```bash
node scripts/preflight.js
```

It checks Postgres, RabbitMQ, Redis, every `.env`, every `node_modules`, and which
service ports are already in use. It exits non-zero if something blocking is missing,
and it is safe to run at any time.

---

## 2. Infrastructure

| Service | Port | Needed by |
|---|---|---|
| PostgreSQL | 5432 | all five services (one database each) |
| RabbitMQ | 5672 | every event |
| RabbitMQ management UI | 15672 | you, for inspecting queues |
| Redis | 6379 | order-service and product-service |

### Redis

If preflight says Redis is down, start it one of these ways.

Docker (start Docker Desktop first):

```bash
docker run -d --name edoms-redis -p 6379:6379 redis:7-alpine
```

WSL:

```bash
wsl -d Ubuntu -e bash -lc "sudo apt update && sudo apt install -y redis-server && sudo service redis-server start"
```

**Redis is optional.** It used to be load-bearing - order-service awaited
`redis.get()` before doing anything, and product-service's client called
`process.exit(1)` when it could not connect, which took the service (and its
test run) down with it. Neither is true now: cache reads fall back to their
source and cache writes are wrapped, so an outage costs a cold cache and
nothing else.

The whole system, including `npm run test:all` and `npm run smoke:all`, passes
with Redis absent. Start it only if you want the cache path exercised.

### Databases

Each service owns its own database: `auth_service`, `product_service`,
`inventory_service`, `order_service`, `payment_service`. Create any that are missing:

```bash
psql -U postgres -c "CREATE DATABASE order_service;"
```

Tables are created on boot by `sync({ alter: true })`. That is convenient now and is
replaced by real migrations in Phase 7 (see ROADMAP.md).

---

## 3. Configuration

Every service needs its own `.env`. Copy the template and fill it in:

```bash
cp order-service/.env.example order-service/.env
```

`JWT_SECRET` must be **identical in all five services** or tokens issued by
auth-service are rejected everywhere else.

`BROKER_URL` defaults to `amqp://localhost:5672` when unset, which is why the
services find RabbitMQ without it being configured anywhere.

---

## 4. Start the services

All five in one terminal, with colour-coded prefixed logs:

```bash
npm run dev
```

A subset:

```bash
node scripts/dev.js order inventory
```

Or one service on its own, in its own terminal:

```bash
cd order-service && npm run dev
```

Ctrl+C sends `SIGTERM`, so each service runs its graceful-shutdown handler and drains
in-flight messages rather than dropping them.

---

## 5. Watch the events — this is the part that matters

In a second terminal:

```bash
npm run trace
```

You get a live feed of every event crossing the system, with the consumer each one
wakes up:

```
05:24:51.264  product_service/product_created    product created   -> inventory initializes stock
05:24:51.516  order_service/create_order         order_created     -> inventory reserves stock
05:24:51.778  inventory_service/stock_decrement  Stock Decrement   -> product refreshes Redis cache
05:24:52.031  payment_service/payment_success    payment_success   -> inventory confirms reservation
05:24:52.294  inventory_service/order_confirmed  order confirmed   -> order marks CONFIRMED
```

With full event bodies:

```bash
npm run trace:payloads
```

The tracer binds its own temporary queues, so it receives **copies**. It never steals
messages from the real consumers, and stopping it leaves nothing behind.

---

## 5b. Ask a service how it is doing

Every service answers three operator endpoints, outside `/api/v1`:

```bash
curl -s localhost:5003/health          # alive?  (never fails on a dependency)
curl -s localhost:5003/ready | jq      # can it serve? Postgres + RabbitMQ + Redis
curl -s localhost:5003/metrics | grep ^edoms_
```

`/ready` returns `503` and names the failing dependency when a critical one is down.
Redis is **not** critical — it is a cache, so `/ready` stays `200` with Redis stopped
and simply reports it down. That is why the system above still works without Redis
installed.

Every log line carries the `correlationId` of the transaction that caused it, so one
order can be pulled out of five services' output:

```bash
npm run dev 2>&1 | grep <correlationId>
```

The id is returned on every HTTP response as `x-correlation-id`, and you can supply
your own to make an order easy to find:

```bash
curl -i -H "x-correlation-id: my-order-1" -X POST localhost:5003/api/v1/createorder ...
```

The two numbers worth watching are `edoms_outbox_failed_rows` and
`edoms_queue_depth{kind="dead"}`. Both are durable, silent failures — the work
stopped, nothing retries it, and no request is failing to tell you. A non-empty
dead-letter queue also logs `alert="dlq_not_empty"` within 15 seconds.

Full details, including traces: `docs/OBSERVABILITY.md`.

---

## 6. Drive a full order through the system

With the services and the tracer running:

```bash
# 1. Create an admin and log in. Body is {email, password} only - no name.
curl -X POST http://localhost:5000/api/v1/admins   -H "Content-Type: application/json"   -d '{"email":"admin@example.com","password":"Password123!"}'

curl -X POST http://localhost:5000/api/v1/auth/login   -H "Content-Type: application/json"   -d '{"email":"admin@example.com","password":"Password123!"}'
# -> copy the accessToken from the response
```

```bash
# 2. Create a product. Requires name, price (a NUMBER, not a string),
#    and slug (min 6 chars). Admin token required.
#    Tracer: product_created -> inventory initializes stock.
curl -X POST http://localhost:5001/api/v1/createproduct   -H "Content-Type: application/json"   -H "Authorization: Bearer <ADMIN_TOKEN>"   -d '{"name":"Test Widget","price":19.99,"slug":"test-widget"}'
```

```bash
# 3. Set the stock. THIS STEP IS REQUIRED.
#    The product_created event carries no stock field, so inventory
#    initializes the product at 0 and any order would fail on
#    "Insufficient stock". See defect #6 in AI_CONTEXT.md.
curl -X POST http://localhost:5002/api/v1/updatestock   -H "Content-Type: application/json"   -H "Authorization: Bearer <ADMIN_TOKEN>"   -d '{"id":1,"stock":100}'
```

```bash
# 4. Create an order. userId and productId are numbers.
#    Tracer: order_created -> inventory reserves stock -> stock_decrement.
curl -X POST http://localhost:5003/api/v1/createorder   -H "Content-Type: application/json"   -d '{"userId":1,"items":[{"productId":1,"quantity":2}]}'
```

```bash
# 5. Nothing to do. Watch the trace: payment charges automatically the moment
#    inventory publishes inventory.order.reserved, then the order settles.
#    Poll until it stops changing:
curl http://localhost:5003/api/v1/orderStatus/1
#    pending -> reserved -> paid -> confirmed
```

Since Phase 5 the saga runs itself. `POST /createorder` answers **202 Accepted**
with a `statusUrl`, because the order has been taken on rather than completed -
stock is not yet reserved and payment has not run.

`POST /api/v1/create-payment` still exists for manual retries and operator use.
Both paths converge on the same idempotent service, so an order cannot be
charged twice.

Endpoint reference:

| Service | Method | Path |
|---|---|---|
| auth | POST | `/api/v1/admins`, `/api/v1/users`, `/api/v1/auth/login`, `/api/v1/auth/refresh` |
| product | POST/GET/PUT/DELETE | `/api/v1/createproduct`, `/products`, `/product/:id`, `/product/slug/:slug`, `/updateproduct/:id`, `/deleteproduct/:id` |
| inventory | GET/POST | `/api/v1/stock/:id`, `/stocks`, `/reservedstocks`, `/reservedstock/:id`, `/updatestock` |
| order | POST/GET | `/api/v1/createorder`, `/order/:id`, `/orderStatus/:id` |
| payment | POST | `/api/v1/create-payment` |

Watch the trace while this runs. Every event carries the same `correlationId`, so one
order reads as one unbroken chain - including the payment hop, which used to start a new
trace because a human began it.

---

## 6b. Testing it yourself in Postman

If you would rather click through it than run a script, import:

```
docs/postman/EDOMS.postman_collection.json
```

Postman -> Import -> drop the file in. 7 folders, 24 requests, no environment file
needed - the variables live in the collection.

**Run the folders in order.** Each request captures what the next one needs
(`adminToken`, `userToken`, `userId`, `productId`, `orderId`) into collection variables,
so you never copy-paste an id. Every request has a description explaining which event it
fires and which service reacts; requests marked `[EVENT]` publish something.

Keep `npm run trace` open in a terminal beside Postman. That is the whole point - you
click a request and watch the resulting events land.

| Folder | What it does |
|---|---|
| 1 - Auth | Registers admin + user, captures both tokens |
| 2 - Product | Creates a product, fires `product created` |
| 3 - Inventory | Shows stock is 0, sets it to 100 |
| 4 - Order | Places the order, shows stock drop to 98, order `pending` |
| 5 - Payment | Real Stripe **test-mode** charge, order becomes `confirmed` |
| 6 - Failure path | Injects `payment_failure`, order becomes `failed`, stock restored |
| 7 - Inspect the broker | Queue depths and dead-letter contents over HTTP |

For the failure path: run folders 1-4 to get a fresh pending order, then **skip folder 5**
and run folder 6.

Postman cannot speak AMQP, so folder 6 publishes through RabbitMQ's management HTTP API
instead. Expect `{"routed": true}`.

Each request has Postman tests attached, so you get green/red per step in the Test
Results tab rather than having to eyeball JSON.

Stop at **"4 - Order / Order status (expect pending)"** and look at your trace terminal.
It went quiet after `stock_decrement` and will stay quiet forever. Nothing charges the
card until you send folder 5 yourself. That silence is the Phase 5 gap.

## 7. Inspect queues when something looks stuck

RabbitMQ management UI: <http://localhost:15672> (guest / guest)

Go to **Queues**. Each consumer now has a durable, named queue plus two companions:

| Queue | Meaning |
|---|---|
| `inventory-service.order-created` | the live queue |
| `inventory-service.order-created.retry` | failed messages waiting out their TTL before another attempt |
| `inventory-service.order-created.dead` | gave up after 5 attempts - **needs a human** |

What the depths tell you:

- **Main queue growing** - the consumer is down or too slow.
- **Retry queue non-empty** - a handler is throwing. Check that service's logs.
- **Dead queue non-empty** - messages were permanently abandoned. Click the queue,
  "Get messages", and the `x-death-reason` header says whether it was `malformed` or
  `max-deliveries-exceeded`.

A dead-letter queue nobody watches is the same as silently dropping messages, which is
what the system did before Phase 1. Alerting on this is a Phase 6 item.

---

## 8. Verify the delivery guarantees yourself

```bash
cd order-service && npm run build && cd ..
node scripts/verify-messaging.js
```

Against a live broker, this proves: an event published while a consumer is offline is
still delivered when it restarts; a throwing handler retries a bounded number of times
and then dead-letters; malformed JSON goes straight to the DLQ without looping; and
published messages are persistent and confirmed.

---

## Logs

All five services log through `packages/shared-observability`. Each service's
`src/utils/logger.ts` is now a three-line re-export of it, so there is one place to
change the format.

In development, logs go to the **console only**, in a readable format with the first
8 characters of the correlationId as a prefix:

```
02:57:16.133 info  [1c47bb8e] Received inventory.reservation.failed {"eventType":...,"queue":...}
```

Daily-rotate file transports are added only when `NODE_ENV === "production"`, so
`npm run dev` streams everything to one terminal and writes nothing to disk. Files
already in a service's `logs/` directory are leftovers from an older run — check the
date before trusting them.

| Want | Do |
|---|---|
| Machine-readable output | `LOG_FORMAT=json` |
| Less noise | `LOG_LEVEL=info` |
| Files while developing | `NODE_ENV=production` |

> **`NODE_ENV` has to be exactly `production`.** A value like
> `NODE_ENV=production npm run dev` — a shell command pasted into a `.env` — leaves
> every production branch off, so file logging and the `info` default never engage,
> silently. Check yours with `grep NODE_ENV */.env`.

## Common problems

| Symptom | Cause |
|---|---|
| ~~Order creation hangs~~ | No longer true. Phase 5 moved order-service onto a local product projection, and cache writes are now wrapped, so Redis being down costs a cold cache and nothing else. |
| `ECONNREFUSED 127.0.0.1:5672` | RabbitMQ is down. Events cannot publish. |
| Order stays `pending` forever after a failed payment | Was the `invetory_service` exchange typo, fixed in Phase 1. If it recurs, check both sides agree on the exchange name. |
| Order sits in `pending` or `reserved` and then goes `cancelled` | The saga timeout worker expired it (default 5 min, `SAGA_TIMEOUT_MS`). Something upstream never responded - check the queues and the DLQs. |
| Order is `paid` but never `confirmed` | The payment went through but `inventory.reservation.confirmed` did not arrive. Deliberately NOT auto-expired: money has moved, so it needs a human. |
| Order stays `pending` after a successful payment | Insufficient stock. inventory skips the item without publishing a failure event - Phase 3. |
| `JsonWebTokenError: invalid signature` | `JWT_SECRET` differs between services. |
| Stale stock in product responses | Redis cache not invalidated on admin stock update - Phase 2. |
