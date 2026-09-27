# EDOMS event catalogue

Every event is defined once, in `packages/shared-events`. Services name the
event and nothing else; the exchange and routing key are derived from
`EXCHANGE_FOR`, so a publisher and a consumer cannot disagree about where an
event lives.

That property is the point. The original defect in this system was
`inventory_service` on one side and `invetory_service` on the other — a
one-letter difference that silently broke the order-failure path. It is no
longer expressible.

---

## Envelope

Every message on the wire:

```json
{
  "eventId": "8f14e45f-e29b-41d4-a716-446655440000",
  "eventType": "order.created",
  "eventVersion": 1,
  "occurredAt": "2026-09-27T07:37:17.238Z",
  "producer": "order-service",
  "correlationId": "d4b4e661-...",
  "causationId": "3b2a1c09-...",
  "payload": { }
}
```

| Field | Purpose |
|---|---|
| `eventId` | Unique per message. Also the AMQP `messageId`, and the key consumers deduplicate on. |
| `eventType` | The canonical name. Also the routing key. |
| `eventVersion` | Schema version. Bump when a payload changes incompatibly. |
| `occurredAt` | When the fact happened, not when it was delivered. |
| `producer` | Which service published it. |
| `correlationId` | Minted when a business transaction starts, copied onto every event it causes. Without it an async flow cannot be reconstructed from logs. |
| `causationId` | The `eventId` of the event being reacted to, so the chain can be walked one hop at a time. |

---

## Naming

`<domain>.<thing>.<pastTense>` — always lowercase, always dot-separated,
always a fact that has already happened.

Before Phase 2 there were four competing styles compared by string equality:
`order_created`, `"Stock Decrement"`, `"order confirmed"`, `"product created"`.

---

## Exchanges

Four durable **topic** exchanges, one per producing domain. Routing key is the
full event name, so a consumer can bind `inventory.reservation.*` rather than
listing every key by hand.

| Exchange | Published by |
|---|---|
| `product.events` | product-service |
| `order.events` | order-service |
| `inventory.events` | inventory-service |
| `payment.events` | payment-service |

---

## The catalogue

| Event | Producer | Consumers | Payload |
|---|---|---|---|
| `product.created` | product | inventory → creates stock row | `{id, name, price, slug, stock?}` |
| `product.updated` | product | order → invalidates `product:<id>` cache | `{id, name?, price?, slug?}` |
| `product.deleted` | product | inventory → deletes stock + reservations<br>order → invalidates cache | `{id}` |
| `order.created` | order | inventory → reserves stock | `{orderId, userId?, items[], status?, totalAmount?, createdAt?}` |
| `inventory.stock.reserved` | inventory | product → refreshes Redis cache | `{productId, orderId?, quantity?}` |
| `inventory.order.reserved` | inventory | **payment → charges the order**<br>order → marks `reserved` | `{orderId, userId?, items[{productId, quantity, price, name?}], reservedAt?}` |
| `inventory.stock.updated` | inventory | product → invalidates stock cache | `{productId, stock}` |
| `inventory.reservation.confirmed` | inventory | order → marks `confirmed` | `{orderId, confirmedAt?}` |
| `inventory.reservation.released` | inventory | order → marks `failed`<br>product → rolls back cache | `{orderId, productId, rolledBackQuantity, failedAt?}` |
| `inventory.reservation.failed` | inventory | order → marks `failed` | `{orderId, productId?, requestedQuantity?, reason?, failedAt?}` |
| `payment.succeeded` | payment | inventory → confirms reservation | `{orderId, userId?, items?}` |
| `payment.failed` | payment | inventory → releases stock | `{orderId, reason?}` |

`orderId` on `inventory.reservation.released` is **required**. Its absence was
defect #17: order-service looked the order up by `undefined`, found nothing,
and left the order pending forever while stock and the reservation were
correctly reverted.

---

## Validation

The payload is validated twice:

- **On publish**, so a malformed event fails at its source rather than three
  services away.
- **On consume**, before the handler runs, so business logic only ever sees
  well-formed data.

A contract violation is dead-lettered **immediately**, not retried — a payload
of the wrong shape will not become the right shape on attempt four. It lands in
`<queue>.dead` with `x-death-reason: contract-violation`.

---

## Changing an event

1. Add the field as **optional** in its schema, and publish it. Old consumers
   ignore it; new ones can read it.
2. Once every consumer reads it, make it required and bump `eventVersion`.

Never repurpose an existing field. Add a new one and retire the old.

---

## Legacy names

`LEGACY_EVENT_ALIASES` maps every pre-Phase-2 name onto its canonical
equivalent, and `parseEnvelope` accepts the old `{ event, data }` shape, so
messages already sitting in a durable queue at migration time are not stranded.

Publishers must never use them. Delete the alias table once the old queues have
drained.

---

## The saga

```
POST /createorder
   |
   |  202 Accepted  (statusUrl for polling)
   v
order.created ................................. order: pending
   |
   v
inventory reserves stock (conditional UPDATE)
   |
   +--> inventory.stock.reserved ............... product refreshes cache
   |
   +--> inventory.order.reserved ............... order: reserved
           |
           v
        payment charges Stripe                  <- no client involvement
           |
           +--> payment.succeeded ............... order: paid
           |       |
           |       v
           |    inventory confirms reservation
           |       |
           |       +--> inventory.reservation.confirmed ... order: confirmed
           |
           '--> payment.failed
                   |
                   v
                inventory releases stock
                   |
                   '--> inventory.reservation.released .... order: failed

insufficient stock:
   inventory.reservation.failed ................ order: failed

nothing arrives before the deadline:
   saga timeout worker ......................... order: cancelled
```

One `correlationId` runs through the whole chain. Before Phase 5 it broke in
two, because payment was started by a separate client request and so began a
new transaction:

```
[d4b4e661]  order.created
[d4b4e661]  inventory.stock.reserved
[891ee1dc]  payment.succeeded              <- different id: a human re-entered
[891ee1dc]  inventory.reservation.confirmed
```

Now:

```
[9c3028de]  order.created
[9c3028de]  inventory.stock.reserved
[9c3028de]  inventory.order.reserved
[9c3028de]  payment.succeeded              <- automatic
[9c3028de]  inventory.reservation.confirmed
```

## Saga timeouts

An async saga has no natural failure: if an event is lost or a consumer never
returns, the order simply waits. A worker in order-service sweeps every 30
seconds and cancels anything in `pending` or `reserved` past
`SAGA_TIMEOUT_MS` (default 5 minutes), publishing
`inventory.reservation.failed` so inventory releases the stock it is holding.

`paid` is deliberately never expired. Money has changed hands, and that needs
a human rather than a timer.

## Prices are required

`price` is mandatory on `order.created` items. Payment charges from the value
carried on the event and never calls back for it. An item without a price used
to default to 0 downstream, which Stripe rejects as below the minimum charge -
failing the order for a reason that had nothing to do with the customer.
