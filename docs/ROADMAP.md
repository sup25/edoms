# EDOMS Roadmap: from microservices to event-driven

**Current: v1.0.0** - partly event-driven. State propagation between services is already
genuine choreography (7 of 9 handlers act on the event payload alone, including a correct
compensating transaction on payment failure). What is missing is that a client, not an
event, starts each chain - and both entry points block on HTTP before writing.
**Target: v2.0.0** - one continuous chain from a single entry point; REST serves client
reads only.

The phases are ordered so the system keeps working the whole way. Phase 1 and 2 are
prerequisites for everything else: there is no point making the flow event-driven while
events can still be silently dropped.

---

## Phase 0 - Audit (done)

- [x] Map the real flow across all five services.
- [x] Confirm the gap between "event-driven" in the README and the code.
- [x] Catalogue defects.
- [x] Root `.gitignore`, AI context file, this roadmap.

---

## Phase 1 - Stop losing messages (DONE)

Verified against a live broker with `node scripts/verify-messaging.js` (9/9 checks).

- [x] **Fix the `invetory_service` exchange typo.** Rename to `inventory_service` in
      `inventory-service/src/handler/handlePaymentSuccessEvent.ts` and
      `order-service/src/handler/handleOrderConfirmedEvent.ts` **in the same change** as
      the already-correct publisher in `handlePaymentFailure.Event.ts`. Today the
      order-failure path is dead: orders stay `pending` forever after a failed payment.
- [x] **Durable, named queues.** Replace `assertQueue("", { exclusive: true })` with
      `assertQueue("<service>.<purpose>", { durable: true })` so events survive a restart
      and replicas compete for work instead of each getting a copy.
- [x] **Ack after the handler, not before.** `await` the handler, then `ack`; on failure
      `nack` with requeue for transient errors.
- [x] **Dead-letter queues.** Give every queue `x-dead-letter-exchange`, plus a retry
      queue with a TTL for bounded backoff, and a terminal DLQ after N attempts.
- [x] **`prefetch(n)`** on every channel so one consumer cannot swallow the backlog.
- [x] **Persistent messages.** Publish with `{ persistent: true }`.
- [x] **Publisher confirms and a shared connection.** Stop opening a TCP connection per
      publish. One long-lived connection with a confirm channel, publish-time confirms,
      and reconnect-with-backoff.
- [x] **Handlers propagate failures.** Five handlers caught their errors and logged them
      without rethrowing, which would have made the retry path above dead code.
- [x] **Graceful shutdown** (pulled forward from Phase 7) - `SIGTERM`/`SIGINT` closes the
      broker connection and DB pool so in-flight messages are not abandoned.

## Phase 2 - One event contract (DONE)

See `docs/EVENTS.md`. Verified live: 13 subscriptions attach, `npm run smoke:all` green,
correlationIds visible in `npm run trace`.

- [x] **Create `packages/shared-events`** (npm workspace or a private package) holding the
      envelope, the event-name enum, and Zod schemas per event.
- [x] **Standard envelope** on every message:
      `{ eventId, eventType, eventVersion, occurredAt, correlationId, causationId, producer, payload }`.
- [x] **Rename every event to `<domain>.<thing>.<pastTense>`**: `order.created`,
      `inventory.stock.reserved`, `inventory.reservation.failed`, `payment.succeeded`,
      `payment.failed`, `product.created`, `product.updated`, `product.deleted`. Kill
      `"Stock Decrement"`, `"order confirmed"`, `"product created"` and friends.
- [x] **Topic exchanges** (one per producing domain) with routing keys, instead of one
      `direct` exchange per event.
- [x] **Validate on consume.** Reject a malformed event to the DLQ rather than letting it
      throw inside business logic.
- [x] **Wire up the orphan.** `product.updated` now has a consumer: order-service
      invalidates its `product:<id>` cache, which it previously held for 10 minutes
      while happily serving stale prices.
- [x] **One-time broker migration** (`scripts/migrate-broker-phase2.js`) - RabbitMQ
      refuses to redeclare an exchange with a different type, so the old `direct`
      `product.events` had to be deleted before the topic version could be created.

## Phase 3 - Idempotency and correctness (DONE)

Verified live: `npm run smoke:all` (4 modes) plus 37 new unit tests.

- [x] **`processed_events` table per service** (`eventId` primary key). Consume inside a
      transaction: insert the id, do the work, commit. A duplicate insert means skip.
- [x] **Atomic conditional stock decrement.**
      `UPDATE stocks SET stock = stock - :qty WHERE productId = :id AND stock >= :qty`,
      then check affected rows. Replaces the current `findOne` + `decrement` race that
      lets concurrent orders oversell.
- [x] **Atomic rollback.** Same treatment for the payment-failure path, guarded on the
      reservation still being `pending`, so a redelivered event cannot inflate stock.
- [x] **All-or-nothing reservations.** Reserve every item in one transaction. Right now a
      failed item is skipped with `continue`, leaving the order half-reserved and stuck.
- [x] **Emit `inventory.reservation.failed`** when stock is insufficient - today nothing
      is published and the order hangs in `pending` forever.
- [x] **Unique constraint** on `order_reservations (orderId, productId)`.

## Phase 4 - Transactional outbox (DONE)

Verified live with `npm run smoke:crash`: an outbox row written with no publish call
anywhere in the process is picked up by the relay, published, and reaches its consumer.

- [x] **`outbox` table per service**, written in the same transaction as the domain change.
- [x] **Relay worker** polls unpublished rows, publishes, marks them sent. This is what
      makes "the DB changed" and "the event was published" one atomic fact.
- [x] Route every existing `publishEvent` call through the outbox.
- [ ] Optional later: swap polling for logical replication / Debezium. Still polling.

## Phase 5 - Close the gap between the two chains (DONE)

Verified live: an order now goes from POST to `confirmed` with NO payment request,
under ONE correlationId end to end. `npm run smoke` asserts it.

This is the phase that answers the original question. Everything above is groundwork.

Scope note: the existing choreography is kept as-is. The work here is removing the two
synchronous entry points and joining `stock.reserved` to payment, not rewriting the
handlers that already react correctly.

- [x] **Remove synchronous HTTP from the write path.** `order-service` should not call
      product-service and inventory-service before accepting an order. It validates the
      request, writes `order (status=pending)`, emits `order.created`, and returns
      `202 Accepted` with the order id.
- [x] **Inventory reacts** to `order.created` and emits `inventory.stock.reserved` or
      `inventory.reservation.failed`.
- [x] **Payment reacts** to `inventory.stock.reserved` instead of waiting for a second
      HTTP call from the client. This is the single biggest change: today the client is
      the orchestrator.
- [x] **Order saga / state machine** owns the lifecycle:
      `pending -> reserved -> paid -> confirmed`, with `failed` and `cancelled` branches
      and a compensating action per step.
- [x] **Saga timeouts.** If `inventory.stock.reserved` never arrives, expire the order and
      compensate. Nothing should be able to sit in `pending` indefinitely.
- [x] **Denormalise event payloads.** Carry price, name, and quantity on the event so
      consumers stop HTTP-GETing the producer after receiving it (the current
      `handleStockDecrementEvent` pattern).
- [x] **Client reads the result** by polling `GET /orderStatus/:id`; the 202 response
      carries a `statusUrl`. SSE/WebSocket push is still open.

## Phase 6 - Observability

- [ ] **Propagate `correlationId`** from the HTTP request through every event, and log it
      everywhere. Without this an async flow is undebuggable.
- [ ] **Structured JSON logs** with a consistent set of fields across services.
- [ ] **OpenTelemetry traces** spanning HTTP and AMQP hops.
- [ ] **Metrics**: events published/consumed/failed, handler latency, DLQ depth,
      consumer lag.
- [ ] **`/health` and `/ready`** on each service, reporting DB + broker + Redis.
- [ ] **Alert on DLQ depth > 0.** A DLQ nobody watches is the same as dropping messages.

## Phase 7 - Local environment and delivery

- [ ] **`docker-compose.yml`** at the root: postgres (five DBs), rabbitmq with the
      management UI, redis, and all five services. Currently there is no compose file and
      every service is started by hand.
- [ ] **Dockerfile per service** (multi-stage).
- [ ] **`.env.example` per service** - the README tells you to copy one, but none exist.
- [ ] **Sequelize migrations.** Replace `sync({ alter: true })` on boot, which silently
      mutates the schema at runtime.
- [ ] **npm workspaces** at the root so the shared events package is linked, with one
      root `npm run dev`.
- [ ] **GitHub Actions**: typecheck, lint, test, build on every PR.
- [ ] **Graceful shutdown** - drain in-flight messages, close channels and the DB pool on
      `SIGTERM`.

## Phase 8 - Security and hardening

- [ ] **Use the authenticated identity on order creation.** `/createorder` is already
      behind `requireUser`, but `createOrderController` reads `userId` from `req.body` and
      ignores `req.user`, so an authenticated user can order as someone else. Take the id
      from `req.user`.
- [ ] **Authenticate the order read endpoints.** `GET /order/:id` and
      `GET /orderStatus/:id` have NO guard at all - no token, and no ownership check
      inside the controller either - so any order in the system can be read by
      guessing an integer id. Phase 5 made `/orderStatus/:id` the primary way a client
      learns its outcome (202 + `statusUrl`), which promoted an open IDOR endpoint to
      the main read path. Add `requireUser` and filter by owner in the service layer.
- [ ] **Authenticate `POST /create-payment`.** payment-service mounts it with no guard.
      Phase 5 kept it for manual retries, but it is open to anyone. The Stripe
      idempotency key (`payment-<orderId>`) prevents a *double* charge; it does not
      prevent a stranger triggering the *first* one.
- [ ] **Service-to-service auth** for the remaining internal REST calls.
- [ ] **Centralise config.** Validate env vars at boot with Zod and fail fast; no more
      `new Redis()` with no URL and no error handler.
- [ ] **Rate limiting and input sanitisation** (the README claims both; neither is wired
      up everywhere).
- [ ] **Stripe webhooks** instead of relying on the synchronous confirm result, so a
      dropped response cannot lose a real charge.
- [ ] **Rotate the Stripe key** if the working-tree `.env` files were ever shared. They
      are untracked, which is good, but check history before making the repo public.

## Phase 9 - Docs

- [ ] **Rewrite the README architecture section** to describe what the system actually
      does. Right now it claims event-driven, which is the thing this roadmap sets out to
      make true.
- [ ] **`docs/EVENTS.md`** - the event catalogue: name, version, payload, producer,
      consumers.
- [ ] **A sequence diagram** of the v2 order saga.
- [ ] **De-duplicate the README** - the "Contributing" section appears twice.
- [ ] **OpenAPI spec per service.**

---

## Suggested order of attack

1. Phase 1 (the typo alone is a live bug, and durability gates everything else)
2. Phase 2 (contract, before more events get written)
3. Phase 3 (idempotency, before retries are turned on in anger)
4. Phase 7 partially - docker-compose early, so the whole thing is runnable while working
5. Phase 4, then Phase 5 (the actual architecture change)
6. Phases 6, 8, 9
