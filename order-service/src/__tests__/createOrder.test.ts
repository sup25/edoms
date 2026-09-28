import request from "supertest";
import express, { Express } from "express";
import { createOrderController } from "../controller";
import { createOrderService } from "../service";
import { publishToOutbox } from "../rabbitmq/outbox";
import ProductProjection from "../model/productProjection.model";
import sequelize from "../config/db";
import { STATUS_CODES } from "../constants";
import { requireUser } from "../middleware/ValidateUser";
import { validate } from "../middleware/validateRequest";
import { CreateOrderRequestSchema } from "../validations/createorder.request.schema";

jest.mock("ioredis", () => {
  const MockRedis = jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
    setex: jest.fn().mockResolvedValue("OK"),
    on: jest.fn(),
  }));
  return MockRedis;
});
jest.mock("../service");
jest.mock("../model/productProjection.model", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() },
}));
jest.mock("../model/outbox.model", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock("../rabbitmq/outbox", () => ({
  publishToOutbox: jest.fn().mockResolvedValue("evt-1"),
  startOutboxRelay: jest.fn(),
  stopOutboxRelay: jest.fn(),
}));
jest.mock("../middleware/ValidateUser");
jest.mock("../middleware/validateRequest");

const mockedService = createOrderService as jest.Mock;
const mockedProjection = ProductProjection.findByPk as unknown as jest.Mock;

const PRODUCT = { productId: 1, name: "Product A", price: "10.00", slug: "prod-a" };

const ORDER = {
  id: 1,
  userId: 1,
  items: [{ productId: 1, quantity: 2, name: "Product A", price: "10.00" }],
  status: "pending",
  createdAt: new Date().toISOString(),
  totalAmount: "20.00",
};

describe("createOrder", () => {
  let app: Express;
  // Reassignable so a test can change who the token says you are.
  let tokenUserId = 1;

  beforeAll(() => {
    // Stub only `transaction`; mocking config/db wholesale would break
    // Order.init(), which needs a real Sequelize instance.
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async (cb: any) => cb({})) as any);

    app = express();
    app.use(express.json());

    (requireUser as jest.Mock).mockImplementation((req, _res, next) => {
      // The guard is what establishes identity; the controller must read it
      // from here and nowhere else.
      req.user = { id: String(tokenUserId), role: "user" };
      next();
    });
    (validate as jest.Mock).mockImplementation(
      () => (_req: any, _res: any, next: any) => next()
    );

    app.post(
      "/createorder",
      requireUser,
      validate(CreateOrderRequestSchema),
      createOrderController
    );
  });

  beforeEach(() => {
    tokenUserId = 1;
    jest.clearAllMocks();
    mockedProjection.mockResolvedValue(PRODUCT);
    mockedService.mockResolvedValue({ success: true, order: ORDER });
  });

  it("ignores a userId in the body - the token decides who owns the order", async () => {
    // The whole of defect #13. This used to place an order owned by user 999.
    const res = await request(app)
      .post("/createorder")
      .send({ userId: 999, items: [{ productId: 1, quantity: 2 }] });

    expect(res.status).toBe(STATUS_CODES.ACCEPTED);
    expect(mockedService).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1 }),
      expect.anything()
    );
  });

  it("attributes the order to whoever the token says", async () => {
    tokenUserId = 42;
    await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 1, quantity: 2 }] });

    expect(mockedService).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42 }),
      expect.anything()
    );
  });

  it("returns 401 when the request carries no usable identity", async () => {
    // Fails closed: a guard that did not run must not mean "anyone".
    (requireUser as jest.Mock).mockImplementationOnce((_req, _res, next) => next());

    const res = await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 1, quantity: 2 }] });

    expect(res.status).toBe(STATUS_CODES.UNAUTHORIZED);
    expect(mockedService).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty items array", async () => {
    const res = await request(app).post("/createorder").send({ items: [] });
    expect(res.status).toBe(STATUS_CODES.BAD_REQUEST);
  });

  it("returns 400 for a non-positive quantity", async () => {
    const res = await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 1, quantity: 0 }] });

    expect(res.status).toBe(STATUS_CODES.BAD_REQUEST);
  });

  it("returns 404 when the product is not in the local projection", async () => {
    mockedProjection.mockResolvedValue(null);

    const res = await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 99, quantity: 1 }] });

    expect(res.status).toBe(STATUS_CODES.NOT_FOUND);
  });

  it("accepts a valid order with 202, not 201", async () => {
    const res = await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 1, quantity: 2 }] });

    // 202: the order has been taken on, not completed. Stock is not yet
    // reserved and payment has not run.
    expect(res.status).toBe(STATUS_CODES.ACCEPTED);
    expect(res.body.data.statusUrl).toBe("/api/v1/orderStatus/1");
    expect(publishToOutbox).toHaveBeenCalled();
    expect(sequelize.transaction).toHaveBeenCalled();
  });

  it("prices the order from the LOCAL projection, with no HTTP call", async () => {
    await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 1, quantity: 2 }] });

    expect(mockedProjection).toHaveBeenCalledWith(1);
    expect(mockedService).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ productId: 1, price: "10.00", name: "Product A" }),
        ],
      }),
      expect.anything()
    );
  });

  it("accepts an order it cannot possibly fulfil, and lets inventory decide", async () => {
    // order-service no longer pre-checks stock. Checking here would be a
    // second, racy opinion: stock can change between the check and the
    // reservation. inventory-service refuses with a conditional UPDATE and
    // publishes inventory.reservation.failed, which fails the order.
    const res = await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 1, quantity: 999999 }] });

    expect(res.status).toBe(STATUS_CODES.ACCEPTED);
  });

  it("returns 500 when the order cannot be written", async () => {
    mockedService.mockRejectedValue(new Error("db down"));

    const res = await request(app)
      .post("/createorder")
      .send({ items: [{ productId: 1, quantity: 2 }] });

    expect(res.status).toBe(STATUS_CODES.INTERNAL_SERVER_ERROR);
  });
});
