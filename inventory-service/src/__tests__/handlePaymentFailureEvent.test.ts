import { handlePaymentFailureEvent } from "../handler/handlePaymentFailure.Event";
import { EventType } from "@edoms/shared-events";
import { publish } from "../rabbitmq/publisher";
import { processOnce } from "../utils/idempotency";
import OrderReservation from "../model/orderReservation.model";
import sequelize from "../config/db";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { query: jest.fn(), transaction: jest.fn() },
}));
jest.mock("../model/orderReservation.model", () => ({
  __esModule: true,
  default: { findAll: jest.fn(), update: jest.fn() },
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
const mockedFindAll = OrderReservation.findAll as unknown as jest.Mock;

const META = { messageId: "msg-1", correlationId: "corr-abc", causationId: "cause-1", attempt: 1, queue: "q" };

function runWork() {
  mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
    await work({} as any);
    return true;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  runWork();
});

describe("handlePaymentFailureEvent", () => {
  it("releases stock and publishes order_failed WITH orderId (defect #17)", async () => {
    mockedFindAll.mockResolvedValue([
      { id: 1, productId: 7, reservedQuantity: 2, status: "pending" },
    ]);
    // the conditional status UPDATE claims the row, then the stock UPDATE runs
    mockedQuery.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);

    await handlePaymentFailureEvent({ orderId: 55 }, META);

    const failed = mockedPublish.mock.calls.find((c) => c[0] === EventType.RESERVATION_RELEASED);
    expect(failed).toBeDefined();
    // This assertion is the regression guard for defect #17: order-service
    // does findByPk(orderId), so a payload without it leaves orders pending.
    expect(failed![1]).toMatchObject({
      orderId: 55,
      productId: 7,
      rolledBackQuantity: 2,
    });
    expect(failed![1].orderId).toBeDefined();
  });

  it("does NOT release stock twice for an already-cancelled reservation (defect #7)", async () => {
    mockedFindAll.mockResolvedValue([
      { id: 1, productId: 7, reservedQuantity: 2, status: "canceled" },
    ]);
    // the conditional UPDATE matches nothing because status is not 'pending'
    mockedQuery.mockResolvedValue([]);

    await handlePaymentFailureEvent({ orderId: 56 }, META);

    // only the status-claim query ran; no stock credit followed
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("does not release stock for a confirmed (paid) reservation", async () => {
    mockedFindAll.mockResolvedValue([
      { id: 2, productId: 9, reservedQuantity: 5, status: "confirmed" },
    ]);
    mockedQuery.mockResolvedValue([]);

    await handlePaymentFailureEvent({ orderId: 57 }, META);

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("skips entirely when the event is a redelivery", async () => {
    mockedProcessOnce.mockImplementation(async () => false);

    await handlePaymentFailureEvent({ orderId: 58 }, META);

    expect(mockedFindAll).not.toHaveBeenCalled();
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("handles an orderId that arrives as a string", async () => {
    mockedFindAll.mockResolvedValue([
      { id: 3, productId: 1, reservedQuantity: 1, status: "pending" },
    ]);
    mockedQuery.mockResolvedValueOnce([{ id: 3 }]).mockResolvedValueOnce([]);

    // payment-service publishes orderId as a string
    await handlePaymentFailureEvent({ orderId: "59" }, META);

    const failed = mockedPublish.mock.calls.find((c) => c[0] === EventType.RESERVATION_RELEASED);
    expect(failed![1].orderId).toBe(59);
  });

  it("rejects an invalid orderId without touching the database", async () => {
    await handlePaymentFailureEvent({ orderId: "abc" }, META);
    expect(mockedProcessOnce).not.toHaveBeenCalled();
  });

  it("publishes nothing when the order has no reservations", async () => {
    mockedFindAll.mockResolvedValue([]);
    await handlePaymentFailureEvent({ orderId: 60 }, META);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("propagates errors so the subscriber can retry and dead-letter", async () => {
    mockedProcessOnce.mockRejectedValue(new Error("db down"));
    await expect(
      handlePaymentFailureEvent({ orderId: 62 }, META)
    ).rejects.toThrow("db down");
  });
});
