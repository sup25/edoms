import { handlePaymentSuccessEvent } from "../handler/handlePaymentSuccessEvent";
import { publishEvent } from "../rabbitmq/publisher";
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
const mockedFindAll = OrderReservation.findAll as unknown as jest.Mock;

const META = { messageId: "m1", attempt: 1, queue: "q" };

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

    await handlePaymentSuccessEvent("payment_success", { orderId: 70 }, META);

    const confirmed = mockedPublish.mock.calls.find((c) => c[1] === "order_confirmed");
    expect(confirmed).toBeDefined();
    expect(confirmed![3]).toMatchObject({ orderId: 70 });
  });

  it("publishes to the correctly spelled inventory_service exchange (defect #1)", async () => {
    mockedFindAll.mockResolvedValue([{ id: 1, status: "pending" }]);
    mockedQuery.mockResolvedValue([{ id: 1 }]);

    await handlePaymentSuccessEvent("payment_success", { orderId: 71 }, META);

    // Regression guard: this was "invetory_service" and silently mismatched.
    expect(mockedPublish).toHaveBeenCalledWith(
      "inventory_service", "order_confirmed", expect.anything(), expect.anything()
    );
  });

  it("does not resurrect a reservation already cancelled by a failure", async () => {
    mockedFindAll.mockResolvedValue([{ id: 1, status: "canceled" }]);
    mockedQuery.mockResolvedValue([]); // no pending rows matched

    await handlePaymentSuccessEvent("payment_success", { orderId: 72 }, META);

    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("skips a redelivered event", async () => {
    mockedProcessOnce.mockImplementation(async () => false);
    await handlePaymentSuccessEvent("payment_success", { orderId: 73 }, META);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("publishes nothing when the order has no reservations", async () => {
    mockedFindAll.mockResolvedValue([]);
    await handlePaymentSuccessEvent("payment_success", { orderId: 74 }, META);
    expect(mockedPublish).not.toHaveBeenCalled();
  });

  it("rejects an invalid orderId", async () => {
    await handlePaymentSuccessEvent("payment_success", { orderId: "nope" }, META);
    expect(mockedProcessOnce).not.toHaveBeenCalled();
  });

  it("propagates errors so the subscriber can retry", async () => {
    mockedProcessOnce.mockRejectedValue(new Error("boom"));
    await expect(
      handlePaymentSuccessEvent("payment_success", { orderId: 75 }, META)
    ).rejects.toThrow("boom");
  });
});
