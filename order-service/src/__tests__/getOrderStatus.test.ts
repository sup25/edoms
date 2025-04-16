import request from "supertest";
import express from "express";
import { getOrderStatusByIdController } from "../controller";
import { STATUS_CODES } from "../constants";
import * as service from "../service";

import sequelize from "../config/db";
jest.mock("../service");
const mockedService = jest.mocked(service);

describe("GET /orderStatus/:id", () => {
  let app: express.Express;
  let server: any; // Store server reference

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.get("/orderStatus/:id", getOrderStatusByIdController);
    server = app.listen(); // Start the Express server
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return order status if the order exists", async () => {
    const mockOrder = "completed";
    mockedService.getOrderStatusByIdService.mockResolvedValue(mockOrder);
    const response = await request(app).get("/orderStatus/1");
    expect(response.status).toBe(STATUS_CODES.OK);
    expect(response.body).toEqual({
      success: true,
      message: "Order status fetched successfully",
      data: mockOrder,
    });
  });

  it("should return 404 if order is not found", async () => {
    mockedService.getOrderStatusByIdService.mockRejectedValue(
      new Error("Order not found")
    );
    const response = await request(app).get("/orderStatus/999");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "Order not found",
    });
  });

  it("should return 500 if service throws an error", async () => {
    mockedService.getOrderStatusByIdService.mockRejectedValue(
      new Error("Unexpected error")
    );
    const response = await request(app).get("/orderStatus/1");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Failed to fetch order status",
      data: null,
    });
  });
});
