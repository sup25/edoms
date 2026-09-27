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

Without Redis, order-service hangs when creating an order: the controller awaits
`redis.get()` before it does anything else.

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
# 5. Pay. Nothing triggered this for you - that is the Phase 5 gap.
#    Tracer: payment_success -> order_confirmed -> order marks CONFIRMED.
curl -X POST http://localhost:5004/api/v1/create-payment   -H "Content-Type: application/json"   -d '{"orderId":1,"userId":1,"items":[{"productId":1,"quantity":2,"price":19.99}]}'
```

```bash
# 6. Confirm the state actually changed
curl http://localhost:5003/api/v1/orderStatus/1
```

Endpoint reference:

| Service | Method | Path |
|---|---|---|
| auth | POST | `/api/v1/admins`, `/api/v1/users`, `/api/v1/auth/login`, `/api/v1/auth/refresh` |
| product | POST/GET/PUT/DELETE | `/api/v1/createproduct`, `/products`, `/product/:id`, `/updateproduct/:id`, `/deleteproduct/:id` |
| inventory | GET/POST | `/api/v1/stock/:id`, `/stocks`, `/reservedstocks`, `/reservedstock/:id`, `/updatestock` |
| order | POST/GET | `/api/v1/createorder`, `/order/:id`, `/orderStatus/:id` |
| payment | POST | `/api/v1/create-payment` |

Note step 4: **you** had to trigger payment. Nothing in the system reacted to the stock
reservation by charging the card. That gap is what Phase 5 closes.

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

In development, logs go to the **console only**. `src/utils/logger.ts` adds the
daily-rotate file transports only when `NODE_ENV === "production"`:

```ts
if (process.env.NODE_ENV === "production") {
  logger.add(new DailyRotateFile({ filename: `${logDir}/combined-%DATE%.log`, ... }));
}
```

So `npm run dev` streams everything to one terminal, prefixed by service, and nothing is
written to disk. Any files already in a service's `logs/` directory are leftovers from an
older production-mode run - check the date before trusting them.

To get file logs while developing, start a service with `NODE_ENV=production`, or move
the two `logger.add(...)` calls outside the `if`.

## Common problems

| Symptom | Cause |
|---|---|
| Order creation hangs | Redis is down. order-service awaits `redis.get()` first. |
| `ECONNREFUSED 127.0.0.1:5672` | RabbitMQ is down. Events cannot publish. |
| Order stays `pending` forever after a failed payment | Was the `invetory_service` exchange typo, fixed in Phase 1. If it recurs, check both sides agree on the exchange name. |
| Order stays `pending` after a successful payment | Insufficient stock. inventory skips the item without publishing a failure event - Phase 3. |
| `JsonWebTokenError: invalid signature` | `JWT_SECRET` differs between services. |
| Stale stock in product responses | Redis cache not invalidated on admin stock update - Phase 2. |
