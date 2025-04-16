import request from "supertest";
import express from "express";
import { getOrderDetailsByIdController } from "../controller";
import { STATUS_CODES } from "../constants";
import * as service from "../service";

jest.mock("../service");
const mockedService = jest.mocked(service);

describe("GET /order/:id", () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.get("/order/:id", getOrderDetailsByIdController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return order details if the order exists", async () => {
    const mockOrder = {
      items: [{ id: 1, name: "Product A", quantity: 2 }],
      status: "completed",
    };

    mockedService.getOrderDetailsByIdService.mockResolvedValue(mockOrder);
    const response = await request(app).get("/order/1");
    expect(response.status).toBe(STATUS_CODES.OK);
    expect(response.body).toEqual({
      success: true,
      message: "Order fetched successfully",
      data: mockOrder,
    });
  });

  it("should return 404 if order is not found", async () => {
    mockedService.getOrderDetailsByIdService.mockRejectedValue(
      new Error("Order not found")
    );
    const response = await request(app).get("/order/999");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      message: "Order not found",
    });
  });

  it("should return 500 if service throws an error", async () => {
    mockedService.getOrderDetailsByIdService.mockRejectedValue(
      new Error("Unexpected error")
    );
    const response = await request(app).get("/order/1");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: "Failed to fetch order status",
      data: null,
    });
  });
});
