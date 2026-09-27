import { handleOrderReservationEvent } from "../handler/handleOrderReservationEvent";
import { publishEvent } from "../rabbitmq/publisher";
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
jest.mock("../rabbitmq/publisher", () => ({ publishEvent: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../rabbitmq/subscriber", () => ({ subscribeEvent: jest.fn() }));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../utils/idempotency", () => ({ processOnce: jest.fn() }));

const mockedPublish = publishEvent as jest.Mock;
const mockedProcessOnce = processOnce as jest.Mock;
const mockedQuery = sequelize.query as jest.Mock;
const mockedUpsert = OrderReservation.upsert as unknown as jest.Mock;

/** Runs the work callback against a fake transaction, like the real helper. */
function runWork() {
  mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
    await work({} as any);
    return true;
  });
}

/** Simulates a duplicate: processOnce skips the work entirely. */
function skipAsDuplicate() {
  mockedProcessOnce.mockImplementation(async () => false);
}

const META = { messageId: "msg-1", attempt: 1, queue: "q" };

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpsert.mockResolvedValue([{}, true]);
});

describe("handleOrderReservationEvent", () => {
  it("reserves every item and publishes stock_decrement per product", async () => {
    runWork();
    // each conditional UPDATE affects one row
    mockedQuery.mockResolvedValue([{ productId: 1 }]);

    await handleOrderReservationEvent(
      "order_created",
      { orderId: 10, items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 3 }] },
      META
    );

    expect(mockedUpsert).toHaveBeenCalledTimes(2);
    const decrements = mockedPublish.mock.calls.filter((c) => c[1] === "stock_decrement");
    expect(decrements).toHaveLength(2);
    expect(mockedPublish).not.toHaveBeenCalledWith(
      expect.anything(), "reservation_failed", expect.anything(), expect.anything()
    );
  });

  it("reserves NOTHING when any item is short, and publishes reservation_failed", async () => {
    // first item succeeds, second is short -> zero rows affected
    mockedQuery
      .mockResolvedValueOnce([{ productId: 1 }])
      .mockResolvedValueOnce([]);
    mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
      // the real helper rolls back when work throws; reproduce that contract
      try { await work({} as any); } catch (e) { throw e; }
      return true;
    });

    await handleOrderReservationEvent(
      "order_created",
      { orderId: 11, items: [{ productId: 1, quantity: 1 }, { productId: 2, quantity: 99 }] },
      META
    );

    const failed = mockedPublish.mock.calls.find((c) => c[1] === "reservation_failed");
    expect(failed).toBeDefined();
    expect(failed![3]).toMatchObject({
      orderId: 11,
      productId: 2,
      requestedQuantity: 99,
      reason: "insufficient_stock",
    });

    // defect #6: no partial reservation is left behind
    const decrements = mockedPublish.mock.calls.filter((c) => c[1] === "stock_decrement");
    expect(decrements).toHaveLength(0);
  });

  it("does not decrement twice when the event is redelivered (defect #8)", async () => {
    skipAsDuplicate();

    await handleOrderReservationEvent(
      "order_created",
      { orderId: 12, items: [{ productId: 1, quantity: 2 }] },
      META
    );

    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative quantity instead of reserving it", async () => {
    mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
      try { await work({} as any); } catch (e) { throw e; }
      return true;
    });

    await handleOrderReservationEvent(
      "order_created",
      { orderId: 13, items: [{ productId: 1, quantity: 0 }] },
      META
    );

    const failed = mockedPublish.mock.calls.find((c) => c[1] === "reservation_failed");
    expect(failed).toBeDefined();
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("ignores an unrelated event type", async () => {
    runWork();
    await handleOrderReservationEvent("something_else", { orderId: 1, items: [] }, META);
    expect(mockedProcessOnce).not.toHaveBeenCalled();
  });

  it("ignores a malformed event with no items", async () => {
    runWork();
    await handleOrderReservationEvent("order_created", { orderId: 1, items: [] }, META);
    expect(mockedProcessOnce).not.toHaveBeenCalled();
  });

  it("propagates errors so the subscriber can retry and dead-letter", async () => {
    mockedProcessOnce.mockRejectedValue(new Error("db down"));

    await expect(
      handleOrderReservationEvent(
        "order_created",
        { orderId: 14, items: [{ productId: 1, quantity: 1 }] },
        META
      )
    ).rejects.toThrow("db down");
  });
});
