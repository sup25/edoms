import request from "supertest";
import express from "express";
import { getProductStockController } from "../controller";
import * as service from "../service";

// Mock the service module
jest.mock("../service");
const mockedService = jest.mocked(service);

describe("GET /api/v1/stock/:id", () => {
  const app = express();

  beforeAll(() => {
    app.use(express.json());
    app.get("/api/v1/stock/:id", getProductStockController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch a product stock by id successfully", async () => {
    mockedService.getProductStockById.mockResolvedValue(1);

    const response = await request(app).get("/api/v1/stock/1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "product Stock fetched successfully",
      data: 1,
    });

    expect(mockedService.getProductStockById).toHaveBeenCalledWith(1);
  });

  it("should return 400 when stock is not found", async () => {
    mockedService.getProductStockById.mockRejectedValue(
      new Error("Stock not found for productId: 1")
    );

    const response = await request(app).get("/api/v1/stock/1");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: "Stock not found for productId: 1",
      data: null,
    });

    expect(mockedService.getProductStockById).toHaveBeenCalledWith(1);
  });

  it("should return 500 for unexpected errors", async () => {
    mockedService.getProductStockById.mockRejectedValue(
      new Error("Unexpected error")
    );

    const response = await request(app).get("/api/v1/stock/1");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });

    expect(mockedService.getProductStockById).toHaveBeenCalledWith(1);
  });
});
