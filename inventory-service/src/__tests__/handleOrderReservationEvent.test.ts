import { EventType } from "@edoms/shared-events";
import { handleOrderReservationEvent } from "../handler/handleOrderReservationEvent";
import { publish } from "../rabbitmq/publisher";
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
jest.mock("../rabbitmq/publisher", () => ({ publish: jest.fn().mockResolvedValue("evt-1") }));
jest.mock("../rabbitmq/subscriber", () => ({ subscribeEvent: jest.fn() }));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../utils/idempotency", () => ({ processOnce: jest.fn() }));

const mockedPublish = publish as jest.Mock;
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

/** Runs the work callback against a fake transaction, like the real helper. */
function runWork() {
  mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
    await work({} as any);
    return true;
  });
}

/** The real helper lets the work's error propagate (rolling back). */
function runWorkPropagating() {
  mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
    await work({} as any);
    return true;
  });
}

const publishedTypes = () => mockedPublish.mock.calls.map((c) => c[0]);
const publishedOf = (type: string) =>
  mockedPublish.mock.calls.filter((c) => c[0] === type);

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpsert.mockResolvedValue([{}, true]);
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
    expect(publishedOf(EventType.STOCK_RESERVED)).toHaveLength(2);
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
      expect(call[2]).toMatchObject({ correlationId: "corr-abc" });
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

    // defect #6: no partial reservation is left behind
    expect(publishedOf(EventType.STOCK_RESERVED)).toHaveLength(0);
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
