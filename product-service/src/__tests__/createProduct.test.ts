import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { createProductController } from "../controller";
import * as service from "../service";
import { requireAdmin } from "../middleware/requireAdmin";
import { validate } from "../middleware/validateRequest";
import { CreateProductSchema } from "../validations";
import Product from "../model/product.model";
import * as outbox from "../rabbitmq/outbox";
import connectdb from "../config/db";
import { EventType } from "@edoms/shared-events";

// Mock the service module
jest.mock("../service");
const mockedService = jest.mocked(service);

/*
 * The outbox and the transaction are mocked so the `product created` event is
 * observable. Without this the publish throws (no database in a unit test) and
 * the controller swallows it, which is exactly why defect #16 - stock missing
 * from the event payload - survived a green suite.
 */
jest.mock("../rabbitmq/outbox");
const mockedOutbox = jest.mocked(outbox);

/** A Sequelize instance carries toJSON; the controller relies on it. */
const asInstance = (p: Partial<Product>) =>
  ({ ...p, toJSON: () => p } as unknown as Product);

describe("POST /api/v1/createproduct", () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/api/v1/createproduct",
    requireAdmin,
    validate(CreateProductSchema),
    createProductController
  );

  const mockAdminToken = jwt.sign(
    { id: 1, role: "admin" },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "15m" }
  );

  beforeEach(() => {
    jest.clearAllMocks();
    /*
     * The real Sequelize instance is kept - constructing it opens no
     * connection, and replacing the module breaks Product.init - so only the
     * transaction is stubbed, running the callback inline.
     */
    jest
      .spyOn(connectdb, "transaction")
      .mockImplementation(((cb: (t: unknown) => unknown) => cb({})) as never);
  });

  it("should create a new product successfully", async () => {
    const mockProduct: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product-test",
    };

    mockedService.createProductService.mockResolvedValue(
      asInstance(mockProduct)
    );

    const response = await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
        stock: 7,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      message: "Product created successfully",
      data: { ...mockProduct, stock: 7 },
    });
  });

  it("should throw an error if slug already exists", async () => {
    mockedService.createProductService.mockRejectedValue(
      new Error("Slug already exists. Please use a different slug.")
    );

    const response = await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Slug already exists. Please use a different slug.",
      data: null,
    });
  });

  it("should throw an error if createProductService throws an error", async () => {
    mockedService.createProductService.mockRejectedValue(
      new Error("Test error")
    );

    const response = await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });
  });
  /*
   * Defect #16. The create schema had no stock field, so the event published a
   * product with none, inventory-service read `undefined` and initialized the
   * product at 0, and it could not be ordered until an admin made a second
   * call to POST /updatestock.
   */
  it("should carry the stock on the product created event", async () => {
    const mockProduct: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product-test",
    };
    mockedService.createProductService.mockResolvedValue(
      asInstance(mockProduct)
    );

    await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
        stock: 42,
      });

    expect(mockedOutbox.publishToOutbox).toHaveBeenCalledTimes(1);
    const [eventType, payload] = mockedOutbox.publishToOutbox.mock.calls[0];
    expect(eventType).toBe(EventType.PRODUCT_CREATED);
    expect(payload).toEqual({ ...mockProduct, stock: 42 });
  });

  it("should default the stock to 0 when the caller omits it", async () => {
    const mockProduct: Partial<Product> = {
      id: 2,
      name: "No Stock Product",
      price: 5.0,
      slug: "no-stock-product",
    };
    mockedService.createProductService.mockResolvedValue(
      asInstance(mockProduct)
    );

    const response = await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "No Stock Product",
        price: 5.0,
        slug: "no-stock-product",
      });

    expect(response.status).toBe(201);
    // 0 as a stated default, and it still travels on the event as a number -
    // inventory never has to guess.
    expect(response.body.data.stock).toBe(0);
    const [, payload] = mockedOutbox.publishToOutbox.mock.calls[0];
    expect(payload).toEqual({ ...mockProduct, stock: 0 });
  });

  it("should reject a negative stock", async () => {
    const response = await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
        stock: -1,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Validation error");
    expect(mockedService.createProductService).not.toHaveBeenCalled();
  });

  it("should reject a fractional stock", async () => {
    const response = await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
        stock: 1.5,
      });

    expect(response.status).toBe(400);
    expect(mockedService.createProductService).not.toHaveBeenCalled();
  });
});
