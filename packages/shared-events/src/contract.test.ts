import {
  EventType,
  ALL_EVENT_TYPES,
  EXCHANGE_FOR,
  Exchange,
  canonicalEventType,
  buildEnvelope,
  parseEnvelope,
  EventContractError,
  validatePayload,
  PAYLOAD_SCHEMA,
} from "./index";

describe("event catalogue", () => {
  it("routes every event to an exchange", () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(EXCHANGE_FOR[type]).toBeDefined();
    }
  });

  it("has a payload schema for every event", () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(PAYLOAD_SCHEMA[type]).toBeDefined();
    }
  });

  it("names every event <domain>.<thing>.<pastTense>", () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+(\.[a-z]+)+$/);
      // the old styles: spaces, capitals, snake_case
      expect(type).not.toMatch(/[ A-Z_]/);
    }
  });

  it("maps legacy names onto canonical ones", () => {
    expect(canonicalEventType("Stock Decrement")).toBe(EventType.STOCK_RESERVED);
    expect(canonicalEventType("order confirmed")).toBe(EventType.RESERVATION_CONFIRMED);
    expect(canonicalEventType("order failed")).toBe(EventType.RESERVATION_RELEASED);
    expect(canonicalEventType("payment_success")).toBe(EventType.PAYMENT_SUCCEEDED);
    expect(canonicalEventType("order.created")).toBe(EventType.ORDER_CREATED);
    expect(canonicalEventType("nonsense")).toBeUndefined();
  });

  it("keeps inventory events on the inventory exchange", () => {
    expect(EXCHANGE_FOR[EventType.RESERVATION_RELEASED]).toBe(Exchange.INVENTORY);
    expect(EXCHANGE_FOR[EventType.RESERVATION_CONFIRMED]).toBe(Exchange.INVENTORY);
    // Regression guard for the original defect: both sides now derive the
    // exchange from this one table, so they cannot disagree on its spelling.
    expect(Exchange.INVENTORY).toBe("inventory.events");
  });
});

describe("buildEnvelope", () => {
  it("stamps id, time and version", () => {
    const e = buildEnvelope(EventType.ORDER_CREATED, { orderId: 1 }, { producer: "order-service" });
    expect(e.eventId).toHaveLength(36);
    expect(e.eventVersion).toBe(1);
    expect(e.producer).toBe("order-service");
    expect(() => new Date(e.occurredAt).toISOString()).not.toThrow();
  });

  it("carries the correlationId through when given one", () => {
    const e = buildEnvelope(EventType.ORDER_CREATED, {}, {
      producer: "p", correlationId: "corr-1", causationId: "cause-1",
    });
    expect(e.correlationId).toBe("corr-1");
    expect(e.causationId).toBe("cause-1");
  });

  it("mints a correlationId when none is supplied, so the chain is never unlinkable", () => {
    const e = buildEnvelope(EventType.ORDER_CREATED, {}, { producer: "p" });
    expect(e.correlationId).toHaveLength(36);
  });

  it("omits causationId rather than setting it undefined", () => {
    const e = buildEnvelope(EventType.ORDER_CREATED, {}, { producer: "p" });
    expect("causationId" in e).toBe(false);
  });
});

describe("parseEnvelope", () => {
  it("round-trips a built envelope", () => {
    const built = buildEnvelope(EventType.PAYMENT_SUCCEEDED, { orderId: 5 }, { producer: "payment-service" });
    const parsed = parseEnvelope(JSON.stringify(built));
    expect(parsed).toEqual(built);
  });

  it("upgrades a pre-Phase-2 { event, data } message", () => {
    const legacy = JSON.stringify({ event: "Stock Decrement", data: { productId: 3 } });
    const parsed = parseEnvelope(legacy);

    // Messages already sitting in a durable queue must not be stranded.
    expect(parsed.eventType).toBe(EventType.STOCK_RESERVED);
    expect(parsed.payload).toEqual({ productId: 3 });
    expect(parsed.producer).toBe("legacy");
    expect(parsed.correlationId).toHaveLength(36);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseEnvelope("{ not json")).toThrow(EventContractError);
  });

  it("rejects an unknown event name", () => {
    expect(() => parseEnvelope(JSON.stringify({ event: "made.up", data: {} })))
      .toThrow(/unknown legacy event name/);
  });

  it("rejects an envelope missing required fields", () => {
    expect(() => parseEnvelope(JSON.stringify({ eventType: "order.created", payload: {} })))
      .toThrow(/does not match the event envelope/);
  });
});

describe("validatePayload", () => {
  it("accepts a well-formed payload", () => {
    const ok = validatePayload(EventType.ORDER_CREATED, {
      orderId: 1, items: [{ productId: 2, quantity: 3 }],
    });
    expect(ok).toMatchObject({ orderId: 1 });
  });

  it("requires orderId on reservation.released (the defect #17 guard)", () => {
    expect(() =>
      validatePayload(EventType.RESERVATION_RELEASED, {
        productId: 1, rolledBackQuantity: 2,
      })
    ).toThrow(EventContractError);

    expect(() =>
      validatePayload(EventType.RESERVATION_RELEASED, {
        orderId: 9, productId: 1, rolledBackQuantity: 2,
      })
    ).not.toThrow();
  });

  it("rejects an empty items array on order.created", () => {
    expect(() => validatePayload(EventType.ORDER_CREATED, { orderId: 1, items: [] }))
      .toThrow(EventContractError);
  });

  it("rejects a non-positive quantity", () => {
    expect(() =>
      validatePayload(EventType.ORDER_CREATED, { orderId: 1, items: [{ productId: 1, quantity: 0 }] })
    ).toThrow(EventContractError);
  });

  it("accepts orderId as a string, since payment-service sends one", () => {
    expect(() => validatePayload(EventType.PAYMENT_FAILED, { orderId: "42" })).not.toThrow();
    expect(() => validatePayload(EventType.PAYMENT_FAILED, { orderId: "abc" })).toThrow();
  });
});
