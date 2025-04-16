import request from "supertest";
import express from "express";
import { getStockWithProductIdController } from "../controller";
import * as service from "../service";

jest.mock("../service");
const mockedService = jest.mocked(service);

describe("GET /api/v1/stocks", () => {
  const app = express();

  beforeAll(() => {
    app.use(express.json());
    app.get("/api/v1/stocks", getStockWithProductIdController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch all product id and its stock successfully", async () => {
    const mockData = [
      { productId: 1, stock: 50 },
      { productId: 2, stock: 30 },
    ];

    mockedService.getStockWithProductIdService.mockResolvedValue(mockData);

    const response = await request(app).get("/api/v1/stocks");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "product Stock fetched successfully",
      data: mockData,
    });

    expect(mockedService.getStockWithProductIdService).toHaveBeenCalledWith();
  });

  it("should return 500 for internal server error", async () => {
    mockedService.getStockWithProductIdService.mockRejectedValue(
      new Error("Internal server error")
    );

    const response = await request(app).get("/api/v1/stocks");

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      message: "Error fetching product Stock",
    });

    expect(mockedService.getStockWithProductIdService).toHaveBeenCalledWith();
  });
});
