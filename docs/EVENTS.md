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

## Known gap: the correlation chain breaks at payment

A trace of one order looks like this:

```
[d4b4e661]  order.created                      -> inventory reserves stock
[d4b4e661]  inventory.stock.reserved           -> product refreshes cache
[891ee1dc]  payment.succeeded                  -> inventory confirms reservation
[891ee1dc]  inventory.reservation.confirmed    -> order marks CONFIRMED
```

Two correlation ids, not one. Payment is triggered by a **separate HTTP request
from the client**, which starts a new transaction, so it cannot inherit the
order's id.

This is the same structural gap as Phase 5: the saga has a hole in the middle
where a human re-enters the system. When payment reacts to
`inventory.stock.reserved` instead of waiting for a client call, the
correlationId flows through automatically and one order becomes one trace.
Until then, joining the two halves means going through `orderId`.
