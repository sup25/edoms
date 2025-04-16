import request from "supertest";
import express from "express";
import { getOrderReservationsByIdController } from "../controller";
import * as service from "../service";

// Mock the service module
jest.mock("../service");
const mockedService = jest.mocked(service);

describe("GET /api/v1/reservedstock/:id", () => {
  const app = express();

  beforeAll(() => {
    app.use(express.json());
    app.get("/api/v1/reservedstock/:id", getOrderReservationsByIdController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch a reserved stock by order id successfully", async () => {
    const mockData = [
      {
        id: 1,
        orderId: 1,
        productId: 101,
        reservedQuantity: 10,
        status: "pending",
        createdAt: "2025-03-12T04:40:06.655Z",
        updatedAt: "2025-03-12T04:40:06.655Z",
      },
    ];

    mockedService.getOrderReservationsByIdService.mockResolvedValue(mockData);

    const response = await request(app).get("/api/v1/reservedstock/1");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "reserved stock fetched successfully",
      data: mockData,
    });

    expect(mockedService.getOrderReservationsByIdService).toHaveBeenCalledWith(
      1
    );
  });

  it("should return 404 when no reserved stock is found", async () => {
    mockedService.getOrderReservationsByIdService.mockResolvedValue([]);

    const response = await request(app).get("/api/v1/reservedstock/1");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "No reserved stock found for order ID 1",
    });

    expect(mockedService.getOrderReservationsByIdService).toHaveBeenCalledWith(
      1
    );
  });

  it("should return 500 for unexpected errors", async () => {
    mockedService.getOrderReservationsByIdService.mockRejectedValue(
      new Error("Unexpected error")
    );

    const response = await request(app).get("/api/v1/reservedstock/1");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Internal server error",
      data: null,
    });

    expect(mockedService.getOrderReservationsByIdService).toHaveBeenCalledWith(
      1
    );
  });
});
