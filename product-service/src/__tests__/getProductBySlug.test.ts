import request from "supertest";
import express from "express";
import { getProductBySlugController } from "../controller";
import { validate } from "../middleware/validateRequest";
import { GetProductBySlugParamsSchema } from "../validations";
import * as service from "../service";
import Product from "../model/product.model";
import router from "../routes";

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
    // Changed from mockRejectedValue to mockResolvedValue(null)
    mockedService.getProductBySlugService.mockResolvedValue(null);

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

  it("should handle internal server error from service", async () => {
    mockedService.getProductBySlugService.mockRejectedValue(
      new Error("Internal server error")
    );

    const response = await request(app).get("/api/v1/getproduct/test-product");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });

    expect(mockedService.getProductBySlugService).toHaveBeenCalledWith(
      "test-product"
    );
  });
});

/*
 * The block above mounts the controller on a path of its own making, so it
 * passed for as long as `/product/:slug` sat behind `/product/:id` in the real
 * router and answered every slug with a 400. These tests go through
 * `src/routes` exactly as `src/index.ts` mounts it, so route order is part of
 * what is under test.
 */
describe("GET /api/v1/product/slug/:slug (through the real router)", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", router);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockProduct: Partial<Product> = {
    id: 1,
    name: "Test Product",
    price: 10.0,
    slug: "test-product",
  };

  it("should reach getProductBySlugController, not the id route", async () => {
    mockedService.getProductBySlugService.mockResolvedValue(
      mockProduct as Product
    );

    const response = await request(app).get("/api/v1/product/slug/test-product");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Product fetched successfully",
      data: mockProduct,
    });
    expect(mockedService.getProductBySlugService).toHaveBeenCalledWith(
      "test-product"
    );
    expect(mockedService.getProductByIdService).not.toHaveBeenCalled();
  });

  it("should route an all-digit slug to the slug lookup", async () => {
    // "123456" satisfies both the slug schema (min 6) and the id schema
    // (all digits). The reason the fix is a separate path and not a
    // `/product/:idOrSlug` digit check.
    mockedService.getProductBySlugService.mockResolvedValue(
      mockProduct as Product
    );

    const response = await request(app).get("/api/v1/product/slug/123456");

    expect(response.status).toBe(200);
    expect(mockedService.getProductBySlugService).toHaveBeenCalledWith("123456");
    expect(mockedService.getProductByIdService).not.toHaveBeenCalled();
  });

  it("should return 404 when the slug matches no product", async () => {
    mockedService.getProductBySlugService.mockResolvedValue(null);

    const response = await request(app).get(
      "/api/v1/product/slug/non-existent-product"
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "Product not found",
      data: null,
    });
  });

  it("should still reject a slug shorter than 6 characters", async () => {
    const response = await request(app).get("/api/v1/product/slug/abc");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Validation error");
    expect(mockedService.getProductBySlugService).not.toHaveBeenCalled();
  });

  it("should leave GET /product/:id on the id lookup", async () => {
    mockedService.getProductByIdService.mockResolvedValue(
      mockProduct as Product
    );

    const response = await request(app).get("/api/v1/product/1");

    expect(response.status).toBe(200);
    expect(mockedService.getProductByIdService).toHaveBeenCalledWith(1);
    expect(mockedService.getProductBySlugService).not.toHaveBeenCalled();
  });
});
