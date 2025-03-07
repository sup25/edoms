import request from "supertest";
import express from "express";
import { updateProductController } from "../controller";
import { validate } from "../middleware/validateRequest";
import { UpdateProductBodySchema, UpdateProductParamsSchema } from "../schemas";
import * as service from "../service";
import Product from "../model/product.model";
import { requireAdmin } from "../middleware/requireAdmin";
import jwt from "jsonwebtoken";

// Mock the service module
jest.mock("../service");

// Type the mocked service using jest.Mocked
const mockedService = jest.mocked(service);

describe("PUT /api/v1/updateproduct/:id", () => {
  const app = express();
  app.use(express.json());
  app.put(
    "/api/v1/updateproduct/:id",
    requireAdmin,
    validate(UpdateProductBodySchema, UpdateProductParamsSchema),
    updateProductController
  );
  const mockAdminToken = jwt.sign(
    { id: 1, role: "admin" },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "15m" }
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should update a product successfully", async () => {
    const mockProduct: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product",
    };

    mockedService.updateProductService.mockResolvedValue(
      mockProduct as Product
    );

    const response = await request(app)
      .put("/api/v1/updateproduct/1")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Updated Product",
        price: 20.0,
        slug: "updated-product",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      message: "Product updated successfully",
      data: mockProduct,
    });
  });

  it("should throw an error if slug already exists", async () => {
    mockedService.updateProductService.mockRejectedValue(
      new Error("Slug already exists.")
    );

    const response = await request(app)
      .put("/api/v1/updateproduct/1")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Test Product",
        price: 10.0,
        slug: "test-product",
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Slug already exists.",
      data: null,
    });
  });

  it("should throw an error if updateProductService throws an error", async () => {
    mockedService.updateProductService.mockRejectedValue(
      new Error("Test error")
    );

    const response = await request(app)
      .put("/api/v1/updateproduct/1")
      .set("Authorization", `Bearer ${mockAdminToken}`)
      .send({
        name: "Updated Product",
        price: 20.0,
        slug: "updated-product",
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });
  });
});
