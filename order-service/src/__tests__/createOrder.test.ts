const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

import request from "supertest";
import express, { Express } from "express";
import { createOrderController } from "../controller";
import axios from "axios";
import { createOrderService } from "../service";
import { publishEvent } from "../rabbitmq/publisher";
import { STATUS_CODES } from "../constants";
import { requireUser } from "../middleware/ValidateUser";
import { validate } from "../middleware/validateRequest";
import { CreateOrderRequestSchema } from "../validations/createorder.request.schema";

// Mock dependencies
jest.mock("axios");
jest.mock("ioredis", () => {
  // Mock Redis as a constructor function
  const MockRedis = jest.fn().mockImplementation(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
  }));
  return MockRedis;
});
jest.mock("../service");
jest.mock("../rabbitmq/publisher");
jest.mock("../middleware/ValidateUser");
jest.mock("../middleware/validateRequest");

describe("createOrder", () => {
  let app: Express;

  beforeAll(() => {
    // Set up the Express app with the route
    app = express();
    app.use(express.json());

    // Mock middleware to pass through
    (requireUser as jest.Mock).mockImplementation((req, res, next) => {
      req.user = { id: 1 }; // Mock a user object
      next();
    });
    (validate as jest.Mock).mockImplementation(
      () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction
        ) =>
          next()
    );

    // Set up the route as specified
    app.post(
      "/createorder",
      requireUser,
      validate(CreateOrderRequestSchema),
      createOrderController
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return 400 for invalid userId", async () => {
    const response = await request(app)
      .post("/createorder")
      .send({ userId: -1, items: [{ productId: 1, quantity: 1 }] });

    expect(response.status).toBe(STATUS_CODES.BAD_REQUEST);
    expect(response.body).toEqual({
      success: false,
      message: "Invalid user ID",
      data: null,
    });
  });

  it("should return 400 for invalid items array", async () => {
    const response = await request(app)
      .post("/createorder")
      .send({ userId: 1, items: [] });

    expect(response.status).toBe(STATUS_CODES.BAD_REQUEST);
    expect(response.body).toEqual({
      success: false,
      message: "Items must be a non-empty array",
      data: null,
    });
  });

  it("should return 404 when product is not found", async () => {
    mockRedisGet.mockResolvedValue(null);
    (axios.get as jest.Mock).mockResolvedValue({
      data: { success: false },
    });

    const response = await request(app)
      .post("/createorder")
      .send({ userId: 1, items: [{ productId: 1, quantity: 1 }] });

    expect(response.status).toBe(STATUS_CODES.NOT_FOUND);
    expect(response.body).toEqual({
      success: false,
      message: "Product with ID 1 not found",
    });
  });

  it("should create order successfully with valid data", async () => {
    mockRedisGet.mockResolvedValue(null);
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: { id: 1, name: "Test Product", price: 10 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [{ productId: 1, stock: 5 }],
        },
      });

    const mockOrder = {
      id: 1,
      userId: 1,
      status: "pending",
      totalAmount: 20,
      createdAt: new Date().toISOString(), // Convert to string to match response
    };
    (createOrderService as jest.Mock).mockResolvedValue({ order: mockOrder });
    (publishEvent as jest.Mock).mockResolvedValue(true);

    const response = await request(app)
      .post("/createorder")
      .send({ userId: 1, items: [{ productId: 1, quantity: 2 }] });

    expect(response.status).toBe(STATUS_CODES.CREATED);
    expect(response.body).toEqual({
      success: true,
      message: "Order created successfully",
      data: mockOrder,
    });
    expect(mockRedisSet).toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalled();
  });

  it("should return 400 when stock is insufficient", async () => {
    mockRedisGet.mockResolvedValue(null);
    (axios.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: { id: 1, name: "Test Product", price: 10 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [{ productId: 1, stock: 5 }],
        },
      });

    const response = await request(app)
      .post("/createorder")
      .send({ userId: 1, items: [{ productId: 1, quantity: 10 }] });

    expect(response.status).toBe(STATUS_CODES.BAD_REQUEST);
    expect(response.body).toEqual({
      success: false,
      message: "Insufficient stock for product Test Product",
      data: null,
    });
  });

  it("should return 500 when product service fails", async () => {
    mockRedisGet.mockResolvedValue(null);
    (axios.get as jest.Mock).mockRejectedValue(
      new Error("Service unavailable")
    );

    const response = await request(app)
      .post("/createorder")
      .send({ userId: 1, items: [{ productId: 1, quantity: 1 }] });

    expect(response.status).toBe(STATUS_CODES.INTERNAL_SERVER_ERROR);
    expect(response.body).toEqual({
      success: false,
      message: "Error fetching product 1",
      data: null,
    });
  });

  it("should use cached product when available", async () => {
    const cachedProduct = { id: 1, name: "Cached Product", price: 15 };
    (mockRedisGet as jest.Mock).mockResolvedValue(
      JSON.stringify(cachedProduct)
    );
    (axios.get as jest.Mock).mockResolvedValue({
      data: {
        success: true,
        data: [{ productId: 1, stock: 5 }],
      },
    });
    (createOrderService as jest.Mock).mockResolvedValue({
      order: { id: 1, userId: 1, status: "pending", totalAmount: 15 },
    });

    const response = await request(app)
      .post("/createorder")
      .send({ userId: 1, items: [{ productId: 1, quantity: 1 }] });

    expect(axios.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/product/1")
    );
    expect(response.status).toBe(STATUS_CODES.CREATED);
  });
});
