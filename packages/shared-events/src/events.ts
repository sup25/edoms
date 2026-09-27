/**
 * The event catalogue.
 *
 * Every event name is `<domain>.<thing>.<pastTense>`. Before Phase 2 there were
 * four competing styles matched by string equality - `order_created`,
 * `"Stock Decrement"`, `"order confirmed"`, `"product created"` - which is how
 * a misspelled exchange name survived undetected for so long.
 *
 * Names are compared against these constants, never against string literals.
 */
export const EventType = {
  PRODUCT_CREATED: "product.created",
  PRODUCT_UPDATED: "product.updated",
  PRODUCT_DELETED: "product.deleted",

  ORDER_CREATED: "order.created",

  STOCK_RESERVED: "inventory.stock.reserved",
  // Per ORDER, not per product. This is what payment reacts to, which is what
  // removes the client from the middle of the saga (Phase 5).
  ORDER_RESERVED: "inventory.order.reserved",
  STOCK_UPDATED: "inventory.stock.updated",
  RESERVATION_CONFIRMED: "inventory.reservation.confirmed",
  RESERVATION_RELEASED: "inventory.reservation.released",
  RESERVATION_FAILED: "inventory.reservation.failed",

  PAYMENT_SUCCEEDED: "payment.succeeded",
  PAYMENT_FAILED: "payment.failed",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const ALL_EVENT_TYPES: EventType[] = Object.values(EventType);

/**
 * Topic exchanges, one per producing domain. Routing key is the full event
 * name, so a consumer can bind `inventory.reservation.*` instead of listing
 * every key the way a `direct` exchange forced us to.
 */
export const Exchange = {
  PRODUCT: "product.events",
  ORDER: "order.events",
  INVENTORY: "inventory.events",
  PAYMENT: "payment.events",
} as const;

export type Exchange = (typeof Exchange)[keyof typeof Exchange];

/** Which exchange each event is published to. */
export const EXCHANGE_FOR: Record<EventType, Exchange> = {
  [EventType.PRODUCT_CREATED]: Exchange.PRODUCT,
  [EventType.PRODUCT_UPDATED]: Exchange.PRODUCT,
  [EventType.PRODUCT_DELETED]: Exchange.PRODUCT,

  [EventType.ORDER_CREATED]: Exchange.ORDER,

  [EventType.STOCK_RESERVED]: Exchange.INVENTORY,
  [EventType.ORDER_RESERVED]: Exchange.INVENTORY,
  [EventType.STOCK_UPDATED]: Exchange.INVENTORY,
  [EventType.RESERVATION_CONFIRMED]: Exchange.INVENTORY,
  [EventType.RESERVATION_RELEASED]: Exchange.INVENTORY,
  [EventType.RESERVATION_FAILED]: Exchange.INVENTORY,

  [EventType.PAYMENT_SUCCEEDED]: Exchange.PAYMENT,
  [EventType.PAYMENT_FAILED]: Exchange.PAYMENT,
};

/**
 * Legacy names, kept only so a consumer can still read a message that was
 * published before this migration and is sitting in a durable queue.
 * Publishers must never use these. Delete once the queues have drained.
 */
export const LEGACY_EVENT_ALIASES: Record<string, EventType> = {
  "product created": EventType.PRODUCT_CREATED,
  product_updated: EventType.PRODUCT_UPDATED,
  "product deleted": EventType.PRODUCT_DELETED,
  order_created: EventType.ORDER_CREATED,
  "Stock Decrement": EventType.STOCK_RESERVED,
  "Stock Updated": EventType.STOCK_UPDATED,
  "order confirmed": EventType.RESERVATION_CONFIRMED,
  "order failed": EventType.RESERVATION_RELEASED,
  "reservation failed": EventType.RESERVATION_FAILED,
  payment_success: EventType.PAYMENT_SUCCEEDED,
  payment_failure: EventType.PAYMENT_FAILED,
};

/** Maps a possibly-legacy name onto the canonical one, or undefined. */
export function canonicalEventType(name: string): EventType | undefined {
  if ((ALL_EVENT_TYPES as string[]).includes(name)) return name as EventType;
  return LEGACY_EVENT_ALIASES[name];
}
