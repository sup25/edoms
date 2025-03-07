import request from "supertest";
import express from "express";
import { getProductBySlugController } from "../controller";
import { validate } from "../middleware/validateRequest";
import { GetProductBySlugParamsSchema } from "../schemas";
import * as service from "../service";
import Product from "../model/product.model";

// Mock the service module
jest.mock("../service");

// Type the mocked service using jest.Mocked
const mockedService = jest.mocked(service);

describe("GET /api/v1/getproduct/:slug", () => {
  const app = express();
  app.use(express.json());
  app.get(
    "/api/v1/getproduct/:slug",
    validate(undefined, GetProductBySlugParamsSchema),
    getProductBySlugController
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch a product by slug successfully", async () => {
    const mockProduct: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product",
    };

    mockedService.getProductBySlugService.mockResolvedValue(
      mockProduct as Product
    );

    const response = await request(app).get("/api/v1/getproduct/test-product");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Product fetched successfully",
      data: mockProduct,
    });
  });

  it("should return 404 if product is not found", async () => {
    mockedService.getProductBySlugService.mockRejectedValue(
      new Error("Product not found")
    );

    const response = await request(app).get(
      "/api/v1/getproduct/non-existent-product"
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "Product not found",
      data: null,
    });
  });
});
