import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { createProductController } from "../controller";
import * as service from "../service";
import { requireAdmin } from "../middleware/requireAdmin";
import { validate } from "../middleware/validateRequest";
import { CreateProductSchema } from "../schemas";
import Product from "../model/product.model";

// Mock the service module
jest.mock("../service");
const mockedService = jest.mocked(service);

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
  });

  it("should create a new product successfully", async () => {
    const mockProduct: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product-test",
    };

    mockedService.createProductService.mockResolvedValue(
      mockProduct as Product
    );

    const response = await request(app)
      .post("/api/v1/createproduct")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      message: "Product created successfully",
      data: mockProduct,
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
});
