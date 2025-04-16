import request from "supertest";
import express from "express";
import { getOrderReservationsController } from "../controller";
import * as service from "../service";

interface OrderReservationResponse {
  id: number;
  orderId: number;
  productId: number;
  reservedQuantity: number;
  status: "pending" | "confirmed" | "released" | "canceled";
  createdAt: string;
  updatedAt: string;
}

jest.mock("../service");
const mockedService = jest.mocked(service);

describe("GET /api/v1/reservedstocks", () => {
  const app = express();

  beforeAll(() => {
    app.use(express.json());
    app.get("/api/v1/reservedstocks", getOrderReservationsController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch all reserved stocks successfully", async () => {
    const mockData: OrderReservationResponse[] = [
      {
        id: 1,
        orderId: 20,
        productId: 1,
        reservedQuantity: 1,
        status: "pending",
        createdAt: "2025-03-12T04:40:06.655Z",
        updatedAt: "2025-03-12T04:40:06.655Z",
      },
    ];

    // Mock the service to return the raw data as if it came from Sequelize
    mockedService.getOrderReservationsService.mockResolvedValue(mockData);

    const response = await request(app).get("/api/v1/reservedstocks");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: "reserved order fetched successfully",
      data: mockData,
    });

    expect(mockedService.getOrderReservationsService).toHaveBeenCalledWith();
  });

  it("should return 500 for internal server error", async () => {
    mockedService.getOrderReservationsService.mockRejectedValue(
      new Error("Internal server error")
    );

    const response = await request(app).get("/api/v1/reservedstocks");

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({
      success: false,
      message: "Error fetching reserved order",
    });

    expect(mockedService.getOrderReservationsService).toHaveBeenCalledWith();
  });
});
