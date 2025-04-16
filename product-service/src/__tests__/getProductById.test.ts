import request from "supertest";
import express from "express";
import { getProductByIdController } from "../controller";
import { validate } from "../middleware/validateRequest";
import { getProductByIdSchema } from "../validations";
import * as service from "../service";
import Product from "../model/product.model";

// Mock the service module
jest.mock("../service");
const mockedService = jest.mocked(service);

describe("getProductByIdController", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.get(
      "/api/v1/getproduct/:id",
      validate(undefined, getProductByIdSchema),
      getProductByIdController
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch a product by id successfully", async () => {
    const mockProduct: Partial<Product> = {
      id: 1,
      name: "Test Product",
      price: 10.0,
      slug: "test-product",
    };

    mockedService.getProductByIdService.mockResolvedValue(
      mockProduct as Product
    );

    const response = await request(app).get("/api/v1/getproduct/1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "Product fetched successfully",
      data: mockProduct,
    });

    expect(mockedService.getProductByIdService).toHaveBeenCalledWith(1);
  });
  it("should return 404 for Product not found", async () => {
    mockedService.getProductByIdService.mockResolvedValue(null);

    const response = await request(app).get("/api/v1/getproduct/1");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "Product not found",
      data: null,
    });
  });

  it("should handle internal server error from service", async () => {
    mockedService.getProductByIdService.mockRejectedValue(
      new Error("Internal server error")
    );

    const response = await request(app).get("/api/v1/getproduct/1");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });

    expect(mockedService.getProductByIdService).toHaveBeenCalledWith(1);
  });
});
