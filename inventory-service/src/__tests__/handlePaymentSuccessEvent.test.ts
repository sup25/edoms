import { handlePaymentSuccessEvent } from "../handler/handlePaymentSuccessEvent";
import { EventType, EXCHANGE_FOR } from "@edoms/shared-events";
import { publishToOutbox } from "../rabbitmq/outbox";
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
const mockedFindAll = OrderReservation.findAll as unknown as jest.Mock;

const META = { messageId: "m1", correlationId: "corr-abc", causationId: "cause-1", attempt: 1, queue: "q" };

beforeEach(() => {
  jest.clearAllMocks();
  mockedProcessOnce.mockImplementation(async (_c, _e, _m, work) => {
    await work({} as any);
    return true;
  });
});

describe("handlePaymentSuccessEvent", () => {
  it("confirms pending reservations and publishes order_confirmed", async () => {
    mockedFindAll.mockResolvedValue([{ id: 1, status: "pending" }]);
    mockedQuery.mockResolvedValue([{ id: 1 }]);

    await handlePaymentSuccessEvent({ orderId: 70 }, META);

    const confirmed = mockedPublish.mock.calls.find((c) => c[0] === EventType.RESERVATION_CONFIRMED);
    expect(confirmed).toBeDefined();
    expect(confirmed![1]).toMatchObject({ orderId: 70 });
  });

  it("publishes the canonical reservation.confirmed event (defect #1)", async () => {
    mockedFindAll.mockResolvedValue([{ id: 1, status: "pending" }]);
    mockedQuery.mockResolvedValue([{ id: 1 }]);

    await handlePaymentSuccessEvent({ orderId: 71 }, META);

    // The original defect was a misspelled exchange name on one side only.
    // Since Phase 2 the handler names the EVENT and the exchange is derived
    // from EXCHANGE_FOR, so the two sides cannot drift apart by construction.
    expect(mockedPublish).toHaveBeenCalledWith(
      EventType.RESERVATION_CONFIRMED,
      expect.objectContaining({ orderId: 71 }),
      expect.anything(), // transaction
      expect.anything()
    );
    expect(EXCHANGE_FOR[EventType.RESERVATION_CONFIRMED]).toBe("inventory.events");
  });

  it("does not resurrect a reservation already cancelled by a failure", async () => {
    mockedFindAll.mockResolvedValue([{ id: 1, status: "canceled" }]);
    mockedQuery.mockResolvedValue([]); // no pending rows matched

    await handlePaymentSuccessEvent({ orderId: 72 }, META);

    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("skips a redelivered event", async () => {
    mockedProcessOnce.mockImplementation(async () => false);
    await handlePaymentSuccessEvent({ orderId: 73 }, META);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("publishes nothing when the order has no reservations", async () => {
    mockedFindAll.mockResolvedValue([]);
    await handlePaymentSuccessEvent({ orderId: 74 }, META);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects an invalid orderId", async () => {
    await handlePaymentSuccessEvent({ orderId: "nope" }, META);
    expect(mockedProcessOnce).not.toHaveBeenCalled();
  });

  it("propagates errors so the subscriber can retry", async () => {
    mockedProcessOnce.mockRejectedValue(new Error("boom"));
    await expect(
      handlePaymentSuccessEvent({ orderId: 75 }, META)
    ).rejects.toThrow("boom");
  });
});
