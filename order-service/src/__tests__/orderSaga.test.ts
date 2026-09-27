import {
  handleOrderReserved,
  handlePaymentSucceeded,
} from "../handler/handleOrderSagaEvents";
import { expireStaleOrders } from "../handler/orderSagaTimeout";
import { publishToOutbox } from "../rabbitmq/outbox";
import Order from "../model/order.model";
import sequelize from "../config/db";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { query: jest.fn(), transaction: jest.fn() },
}));
jest.mock("../model/order.model", () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findAll: jest.fn() },
  ORDER_STATUS: ["pending", "reserved", "paid", "confirmed", "failed", "cancelled"],
  IN_FLIGHT_STATUSES: ["pending", "reserved", "paid"],
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

const mockedFindByPk = Order.findByPk as unknown as jest.Mock;
const mockedFindAll = Order.findAll as unknown as jest.Mock;
const mockedTransaction = sequelize.transaction as unknown as jest.Mock;
const mockedOutbox = publishToOutbox as jest.Mock;

function order(status: string) {
  return { id: 1, status, update: jest.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedTransaction.mockImplementation(async (cb: any) => cb({}));
});

describe("saga transition: pending -> reserved", () => {
  it("moves a pending order to reserved", async () => {
    const o = order("pending");
    mockedFindByPk.mockResolvedValue(o);

    await handleOrderReserved({ orderId: 1 });

    expect(o.update).toHaveBeenCalledWith({ status: "reserved" });
  });

  it("does not drag a confirmed order backwards", async () => {
    const o = order("confirmed");
    mockedFindByPk.mockResolvedValue(o);

    await handleOrderReserved({ orderId: 1 });

    expect(o.update).not.toHaveBeenCalled();
  });

  it("is idempotent when the event is redelivered", async () => {
    const o = order("reserved");
    mockedFindByPk.mockResolvedValue(o);

    await handleOrderReserved({ orderId: 1 });

    expect(o.update).not.toHaveBeenCalled();
  });

  it("ignores an event with no orderId", async () => {
    await handleOrderReserved({} as any);
    expect(mockedFindByPk).not.toHaveBeenCalled();
  });
});

describe("saga transition: reserved -> paid", () => {
  it("moves a reserved order to paid", async () => {
    const o = order("reserved");
    mockedFindByPk.mockResolvedValue(o);

    await handlePaymentSucceeded({ orderId: 1 });

    expect(o.update).toHaveBeenCalledWith({ status: "paid" });
  });

  it("accepts a pending order too, since the reserved event may be late", async () => {
    const o = order("pending");
    mockedFindByPk.mockResolvedValue(o);

    await handlePaymentSucceeded({ orderId: 1 });

    expect(o.update).toHaveBeenCalledWith({ status: "paid" });
  });

  it("handles orderId arriving as a string", async () => {
    const o = order("reserved");
    mockedFindByPk.mockResolvedValue(o);

    await handlePaymentSucceeded({ orderId: "1" });

    expect(o.update).toHaveBeenCalledWith({ status: "paid" });
  });

  it("does not move a cancelled order to paid", async () => {
    const o = order("cancelled");
    mockedFindByPk.mockResolvedValue(o);

    await handlePaymentSucceeded({ orderId: 1 });

    expect(o.update).not.toHaveBeenCalled();
  });
});

describe("saga timeout", () => {
  it("cancels a stale order and publishes so stock is released", async () => {
    const stale = order("reserved");
    mockedFindAll.mockResolvedValue([stale]);
    mockedFindByPk.mockResolvedValue(stale);

    const cancelled = await expireStaleOrders();

    expect(cancelled).toBe(1);
    expect(stale.update).toHaveBeenCalledWith({ status: "cancelled" }, expect.anything());
    // Inventory must hear about it, or it holds the stock forever.
    expect(mockedOutbox).toHaveBeenCalledWith(
      expect.stringContaining("reservation.failed"),
      expect.objectContaining({ orderId: 1, reason: "saga_timeout" }),
      expect.anything()
    );
  });

  it("never expires a PAID order - money has moved, a human decides", async () => {
    mockedFindAll.mockResolvedValue([]);
    await expireStaleOrders();

    const where = mockedFindAll.mock.calls[0][0].where;
    const expirable = where.status[Object.getOwnPropertySymbols(where.status)[0]];
    expect(expirable).toEqual(["pending", "reserved"]);
    expect(expirable).not.toContain("paid");
  });

  it("re-checks inside the transaction, so a late event wins the race", async () => {
    const stale = order("reserved");
    mockedFindAll.mockResolvedValue([stale]);
    // by the time the transaction runs, the saga has already confirmed it
    mockedFindByPk.mockResolvedValue(order("confirmed"));

    const cancelled = await expireStaleOrders();

    expect(cancelled).toBe(1); // the sweep counted it
    expect(stale.update).not.toHaveBeenCalled(); // but nothing was changed
    expect(mockedOutbox).not.toHaveBeenCalled();
  });

  it("does nothing when no orders are stale", async () => {
    mockedFindAll.mockResolvedValue([]);
    expect(await expireStaleOrders()).toBe(0);
    expect(mockedOutbox).not.toHaveBeenCalled();
  });

  it("keeps sweeping when one order fails to expire", async () => {
    const bad = order("reserved");
    const good = { ...order("reserved"), id: 2 };
    mockedFindAll.mockResolvedValue([bad, good]);
    mockedFindByPk.mockResolvedValue(bad);
    mockedTransaction
      .mockRejectedValueOnce(new Error("deadlock"))
      .mockImplementation(async (cb: any) => cb({}));

    const cancelled = await expireStaleOrders();

    expect(cancelled).toBe(1);
  });
});
