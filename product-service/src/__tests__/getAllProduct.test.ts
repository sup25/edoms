import request from "supertest";
import express from "express";
import { getAllProductsController } from "../controller";

import * as service from "../service";
import Product from "../model/product.model";

// Mock the service module
jest.mock("../service");

// Type the mocked service using jest.Mocked
const mockedService = jest.mocked(service);
describe("GET /api/v1/products", () => {
  const app = express();
  app.use(express.json());
  app.get("/api/v1/products", getAllProductsController);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch all products successfully", async () => {
    const mockProduct: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product",
    };

    mockedService.getAllProductsService.mockResolvedValue([
      mockProduct,
    ] as Product[]);

    const response = await request(app).get("/api/v1/products");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Products fetched successfully",
      data: [mockProduct],
    });
  });

  it("should handle internal server error", async () => {
    mockedService.getAllProductsService.mockRejectedValue(
      new Error("Internal server error")
    );

    const response = await request(app).get("/api/v1/products");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });
  });
});
