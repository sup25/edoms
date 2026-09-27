import { handleOrderConfirmedEvent } from "../handler/handleOrderConfirmedEvent";
import { handleOrderFailureEvent } from "../handler/handlerOrderFailureEvent";
import { handleReservationFailedEvent } from "../handler/handleReservationFailedEvent";
import Order from "../model/order.model";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { query: jest.fn(), transaction: jest.fn() },
}));
jest.mock("../model/order.model", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock("../rabbitmq/subscriber", () => ({ subscribeEvent: jest.fn() }));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedFindByPk = Order.findByPk as unknown as jest.Mock;

function pendingOrder() {
  return { id: 1, status: "pending", update: jest.fn().mockResolvedValue(undefined) };
}

beforeEach(() => jest.clearAllMocks());

describe("handleOrderConfirmedEvent", () => {
  it("marks a pending order confirmed", async () => {
    const order = pendingOrder();
    mockedFindByPk.mockResolvedValue(order);

    await handleOrderConfirmedEvent("order confirmed", {
      orderId: 1,
      confirmedAt: new Date().toISOString(),
    });

    expect(order.update).toHaveBeenCalledWith({ status: "confirmed" });
  });

  it("leaves a non-pending order alone (idempotent on redelivery)", async () => {
    const order = { id: 1, status: "confirmed", update: jest.fn() };
    mockedFindByPk.mockResolvedValue(order);

    await handleOrderConfirmedEvent("order confirmed", { orderId: 1, confirmedAt: "" });

    expect(order.update).not.toHaveBeenCalled();
  });

  it("does nothing when the order is missing", async () => {
    mockedFindByPk.mockResolvedValue(null);
    await expect(
      handleOrderConfirmedEvent("order confirmed", { orderId: 999, confirmedAt: "" })
    ).resolves.toBeUndefined();
  });
});

describe("handleOrderFailureEvent", () => {
  it("marks a pending order failed", async () => {
    const order = pendingOrder();
    mockedFindByPk.mockResolvedValue(order);

    await handleOrderFailureEvent("order failed", {
      orderId: 1,
      confirmedAt: new Date().toISOString(),
    });

    expect(order.update).toHaveBeenCalledWith({ status: "failed" });
  });

  it("looks the order up by the orderId in the payload (defect #17)", async () => {
    const order = pendingOrder();
    mockedFindByPk.mockResolvedValue(order);

    await handleOrderFailureEvent("order failed", { orderId: 42, confirmedAt: "" });

    // The regression: inventory used to publish this event WITHOUT orderId,
    // so findByPk received undefined and the order stayed pending forever.
    expect(mockedFindByPk).toHaveBeenCalledWith(42);
    expect(mockedFindByPk).not.toHaveBeenCalledWith(undefined);
  });

  it("does not fail an order that is already confirmed", async () => {
    const order = { id: 1, status: "confirmed", update: jest.fn() };
    mockedFindByPk.mockResolvedValue(order);

    await handleOrderFailureEvent("order failed", { orderId: 1, confirmedAt: "" });

    expect(order.update).not.toHaveBeenCalled();
  });
});

describe("handleReservationFailedEvent", () => {
  it("fails an order that inventory could not reserve (defect #6)", async () => {
    const order = pendingOrder();
    mockedFindByPk.mockResolvedValue(order);

    await handleReservationFailedEvent("reservation failed", {
      orderId: 1,
      productId: 5,
      requestedQuantity: 99,
      reason: "insufficient_stock",
    });

    expect(order.update).toHaveBeenCalledWith({ status: "failed" });
  });

  it("is idempotent when redelivered", async () => {
    const order = { id: 1, status: "failed", update: jest.fn() };
    mockedFindByPk.mockResolvedValue(order);

    await handleReservationFailedEvent("reservation failed", { orderId: 1 });

    expect(order.update).not.toHaveBeenCalled();
  });

  it("ignores an event with no orderId", async () => {
    await handleReservationFailedEvent("reservation failed", {} as any);
    expect(mockedFindByPk).not.toHaveBeenCalled();
  });

  it("ignores an unrelated event type", async () => {
    await handleReservationFailedEvent("something else", { orderId: 1 });
    expect(mockedFindByPk).not.toHaveBeenCalled();
  });
});
