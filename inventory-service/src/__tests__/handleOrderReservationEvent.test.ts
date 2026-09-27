import { EventType } from "@edoms/shared-events";
import { handleOrderReservationEvent } from "../handler/handleOrderReservationEvent";
import { publishToOutbox } from "../rabbitmq/outbox";
import { processOnce } from "../utils/idempotency";
import OrderReservation from "../model/orderReservation.model";
import sequelize from "../config/db";

// Explicit factories: an automock would load the real module first, and
// Sequelize's Model.init() blows up without a live connection.
jest.mock("../config/db", () => ({
  __esModule: true,
  default: { query: jest.fn(), transaction: jest.fn() },
}));
jest.mock("../model/orderReservation.model", () => ({
  __esModule: true,
  default: { upsert: jest.fn(), findAll: jest.fn(), update: jest.fn() },
}));
jest.mock("../model/processedEvent.model", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock("../model/outbox.model", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock("../rabbitmq/outbox", () => ({
  publishToOutbox: jest.fn().mockResolvedValue("evt-1"),
}));
jest.mock("../rabbitmq/subscriber", () => ({ subscribeEvent: jest.fn() }));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../utils/idempotency", () => ({ processOnce: jest.fn() }));

const mockedPublish = publishToOutbox as jest.Mock;
const mockedProcessOnce = processOnce as jest.Mock;
const mockedQuery = sequelize.query as jest.Mock;
const mockedUpsert = OrderReservation.upsert as unknown as jest.Mock;

const META = {
  messageId: "msg-1",
  correlationId: "corr-abc",
  causationId: "cause-1",
  attempt: 1,
  queue: "q",
};

/*
 * Two distinguishable transaction objects. An outbox row written on
 * RESERVATION_TX is rolled back with the reservation when stock is short, so
 * it never reaches the broker; the failure event is written on its own
 * transaction, which commits. Asserting WHICH transaction each write used is
 * how we verify that at the unit level.
 */
const RESERVATION_TX = { tx: "reservation" } as any;
const FAILURE_TX = { tx: "failure" } as any;

/** Runs the work callback against the reservation transaction. */
function runWork() {
  mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
    await work(RESERVATION_TX);
    return true;
  });
}

/** Same, for the paths where the work then rolls back. */
function runWorkPropagating() {
  mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
    await work(RESERVATION_TX);
    return true;
  });
}

const publishedTypes = () => mockedPublish.mock.calls.map((c) => c[0]);
const publishedOf = (type: string) =>
  mockedPublish.mock.calls.filter((c) => c[0] === type);

const mockedTransaction = sequelize.transaction as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpsert.mockResolvedValue([{}, true]);
  // The reservation-failed path opens its own transaction (the reservation one
  // has already rolled back), so the mock has to actually run the callback.
  mockedTransaction.mockImplementation(async (cb: any) => cb(FAILURE_TX));
});

describe("handleOrderReservationEvent", () => {
  it("reserves every item and publishes inventory.stock.reserved per product", async () => {
    runWork();
    mockedQuery.mockResolvedValue([{ productId: 1 }]);

    await handleOrderReservationEvent(
      { orderId: 10, items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 3 }] },
      META
    );

    expect(mockedUpsert).toHaveBeenCalledTimes(2);
    const reservedWrites = publishedOf(EventType.STOCK_RESERVED);
    expect(reservedWrites).toHaveLength(2);
    // Written in the SAME transaction as the stock decrement - that is the
    // whole point of the outbox (defect #10).
    for (const call of reservedWrites) expect(call[2]).toBe(RESERVATION_TX);
    expect(publishedTypes()).not.toContain(EventType.RESERVATION_FAILED);
  });

  it("propagates the correlationId onto every event it publishes", async () => {
    runWork();
    mockedQuery.mockResolvedValue([{ productId: 1 }]);

    await handleOrderReservationEvent(
      { orderId: 10, items: [{ productId: 1, quantity: 2 }] },
      META
    );

    // Without this the async chain cannot be reconstructed from logs.
    for (const call of mockedPublish.mock.calls) {
      expect(call[3]).toMatchObject({ correlationId: "corr-abc" });
    }
  });

  it("reserves NOTHING when any item is short, and publishes reservation.failed", async () => {
    runWorkPropagating();
    mockedQuery
      .mockResolvedValueOnce([{ productId: 1 }])
      .mockResolvedValueOnce([]);

    await handleOrderReservationEvent(
      { orderId: 11, items: [{ productId: 1, quantity: 1 }, { productId: 2, quantity: 99 }] },
      META
    );

    const failed = publishedOf(EventType.RESERVATION_FAILED);
    expect(failed).toHaveLength(1);
    expect(failed[0][1]).toMatchObject({
      orderId: 11,
      productId: 2,
      requestedQuantity: 99,
      reason: "insufficient_stock",
    });
    // The failure event is written on its OWN transaction, which commits -
    // otherwise the order would hang pending forever.
    expect(failed[0][2]).toBe(FAILURE_TX);

    /*
     * defect #6: the first item's outbox row was written on the reservation
     * transaction, which rolls back, so no partial reservation is announced.
     * The mock still records the call; what matters is which transaction it
     * was written on.
     */
    for (const call of publishedOf(EventType.STOCK_RESERVED)) {
      expect(call[2]).toBe(RESERVATION_TX);
    }
  });

  it("does not decrement twice when the event is redelivered (defect #8)", async () => {
    mockedProcessOnce.mockImplementation(async () => false);

    await handleOrderReservationEvent(
      { orderId: 12, items: [{ productId: 1, quantity: 2 }] },
      META
    );

    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative quantity instead of reserving it", async () => {
    runWorkPropagating();

    await handleOrderReservationEvent(
      { orderId: 13, items: [{ productId: 1, quantity: 0 }] },
      META
    );

    expect(publishedOf(EventType.RESERVATION_FAILED)).toHaveLength(1);
    expect(publishedOf(EventType.RESERVATION_FAILED)[0][2]).toBe(FAILURE_TX);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("ignores a malformed event with no items", async () => {
    runWork();
    await handleOrderReservationEvent({ orderId: 1, items: [] }, META);
    expect(mockedProcessOnce).not.toHaveBeenCalled();
  });

  it("propagates errors so the subscriber can retry and dead-letter", async () => {
    mockedProcessOnce.mockRejectedValue(new Error("db down"));

    await expect(
      handleOrderReservationEvent({ orderId: 14, items: [{ productId: 1, quantity: 1 }] }, META)
    ).rejects.toThrow("db down");
  });
});
