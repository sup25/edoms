// Mock the service module
jest.mock("../service");
// Mock the redis module from "../utils/redis"
jest.mock("../utils/redis");
// Mock Axios for inventory service calls
jest.mock("axios");
// Mock api for inventory service calls
jest.mock("../config/apiEndpoints", () => ({
  INVENTORY_SERVICE_URL: "http://mock-inventory-service",
}));

import request from "supertest";
import express from "express";
import { getAllProductsController } from "../controller";
import Product from "../model/product.model";
import * as service from "../service";
import axios from "axios";
import redis from "../utils/redis";

// Type the mocked modules
const mockedService = service as jest.Mocked<typeof service>;
const mockedRedis = redis as jest.Mocked<typeof redis>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("GET /api/v1/products", () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.get("/api/v1/products", getAllProductsController);
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("should fetch all products successfully with pagination and stock", async () => {
    // Define mock product data using Product type
    const mockProductData: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product",
    };

    // Create a mock product with toJSON method
    const mockProduct = {
      ...mockProductData,
      toJSON: jest.fn().mockReturnValue(mockProductData),
    } as unknown as Product;

    // Mock service response
    mockedService.getAllProductsService.mockResolvedValue({
      products: [mockProduct],
      totalProducts: 1,
    });

    // Mock Redis mget to return null (simulate missing stock in Redis)
    mockedRedis.mget.mockResolvedValue([null]); // Only one product, so one value

    // Mock inventory service response
    const stockData = [{ productId: 1, stock: 5 }];
    mockedAxios.get.mockResolvedValue({
      data: { data: [{ productId: 1, stock: 5 }] },
    });

    // Mock Redis setex for caching stock
    mockedRedis.setex.mockResolvedValue("OK");

    // Make the request with pagination query params
    const response = await request(app)
      .get("/api/v1/products")
      .query({ page: 1, limit: 10 });

    // Assertions
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Products fetched successfully",
      data: [
        {
          id: 1,
          name: "Test Product",
          price: 10.0,
          slug: "test-product",
          stock: 5, // Stock from inventory service
        },
      ],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalProducts: 1,
      },
    });

    // Verify Redis calls
    expect(mockedRedis.mget).toHaveBeenCalledWith("stock:1");
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "http://mock-inventory-service/stocks"
    );
    expect(mockedRedis.setex).toHaveBeenCalledWith("stock:1", 300, "5");
  });

  it("should use Redis stock when available", async () => {
    // Define mock product data using Product type
    const mockProductData: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product",
    };

    // Create a mock product with toJSON method
    const mockProduct = {
      ...mockProductData,
      toJSON: jest.fn().mockReturnValue(mockProductData),
    } as unknown as Product;

    // Mock service response
    mockedService.getAllProductsService.mockResolvedValue({
      products: [mockProduct],
      totalProducts: 1,
    });

    // Mock Redis mget to return a stock value as a string
    mockedRedis.mget.mockResolvedValue(["15"]);

    // Make the request
    const response = await request(app)
      .get("/api/v1/products")
      .query({ page: 1, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.data[0].stock).toBe(15); // Stock from Redis
    expect(mockedAxios.get).not.toHaveBeenCalled(); // Inventory service not called
  });

  it("should handle internal server error from service", async () => {
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

  it("should handle Redis and inventory service failure gracefully", async () => {
    // Define mock product data using Product type
    const mockProductData: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product",
    };

    // Create a mock product with toJSON method
    const mockProduct = {
      ...mockProductData,
      toJSON: jest.fn().mockReturnValue(mockProductData),
    } as unknown as Product;

    // Mock service response
    mockedService.getAllProductsService.mockResolvedValue({
      products: [mockProduct],
      totalProducts: 1,
    });

    // Mock Redis failure
    mockedRedis.mget.mockRejectedValue(new Error("Redis error"));

    // Mock inventory service failure
    mockedAxios.get.mockRejectedValue(new Error("Inventory service error"));

    // Make the request
    const response = await request(app)
      .get("/api/v1/products")
      .query({ page: 1, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Products fetched successfully",
      data: [
        {
          id: 1,
          name: "Test Product",
          price: 10.0,
          slug: "test-product",
          stock: "Unavailable",
        },
      ],
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalProducts: 1,
      },
    });
  });
});
