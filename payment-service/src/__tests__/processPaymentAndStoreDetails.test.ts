process.env.STRIPE_SECRET_KEY = "test_stripe_key";
import { Request, Response } from "express";
import axios from "axios";
import { processPaymentAndStoreDetailsController } from "../controller";
import { processPaymentAndStoreDetailsService } from "../service";
import { publishEvent } from "../rabbitmq/publisher";
import { calculateTotalAmount } from "../utils/calculateTotalAmount";
import { STATUS_CODES } from "../constants";

// Mock dependencies
jest.mock("axios");
jest.mock("../service");
jest.mock("../rabbitmq/publisher");
jest.mock("../utils/calculateTotalAmount");

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedService = processPaymentAndStoreDetailsService as jest.Mock;
const mockedPublishEvent = publishEvent as jest.Mock;
const mockedCalculateTotalAmount = calculateTotalAmount as jest.Mock;

describe("processPaymentAndStoreDetailsController", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let mockNext: jest.Mock;
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Mock request and response objects
    req = {
      body: {
        orderId: "123",
        userId: "user1",
        items: [
          { productId: 1, quantity: 2, price: 10 },
          { productId: 2, quantity: 1, price: 20 },
        ],
      },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();

    // Default mock for calculateTotalAmount
    mockedCalculateTotalAmount.mockReturnValue(40);
  });

  it("should process payment successfully", async () => {
    // Arrange
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [
              { productId: 1, price: "10" },
              { productId: 2, price: "20" },
            ],
            status: "pending",
          },
        },
      }) // Mock order response
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [
            { orderId: "123", productId: 1, reservedQuantity: 2 },
            { orderId: "123", productId: 2, reservedQuantity: 1 },
          ],
        },
      }); // Mock reserved stock response

    mockedService.mockResolvedValue({
      paymentIntentId: "pi_123",
      status: "success",
      clientSecret: "secret_123",
    });

    mockedPublishEvent.mockResolvedValue(undefined);

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.json).toHaveBeenCalledWith({ status: "success" });
    expect(mockedPublishEvent).toHaveBeenCalledWith(
      "payment_service",
      "payment_success",
      "payment_success",
      { orderId: "123", userId: "user1", items: req.body.items }
    );
  });

  it("should return 400 if order fetch fails", async () => {
    // Arrange
    mockedAxios.get.mockResolvedValueOnce({
      data: { success: false },
    });

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.status).toHaveBeenCalledWith(STATUS_CODES.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Failed to fetch order status",
    });
  });

  it("should return 400 if reserved stock fetch fails", async () => {
    // Arrange
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: { items: [], status: "pending" },
        },
      })
      .mockResolvedValueOnce({
        data: { success: false },
      });

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.status).toHaveBeenCalledWith(STATUS_CODES.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Failed to fetch reserved stocks",
    });
  });

  it("should return 400 if order is already confirmed", async () => {
    // Arrange
    // Mock the order API call
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: { items: [], status: "confirmed" }, // Order status is "confirmed"
        },
      })
      // Mock the reserved stock API call
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [], // Reserved stock response (can be empty for this test)
        },
      });

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.status).toHaveBeenCalledWith(STATUS_CODES.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Payment already processed for this order",
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("should return 400 if price mismatch detected", async () => {
    // Arrange
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [{ productId: 1, price: "15" }], // Price in order API: 15 (string)
            status: "pending", // Not "confirmed" to reach price check
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [], // Reserved stock (not relevant for price mismatch)
        },
      });

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.status).toHaveBeenCalledWith(STATUS_CODES.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Price mismatch detected in order items",
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it("should return 400 if order items do not match reserved stock", async () => {
    // Arrange
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [
              { productId: 1, price: "10" },
              { productId: 2, price: "20" },
            ],
            status: "pending",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [
            { orderId: "123", productId: 1, reservedQuantity: 1 }, // Quantity mismatch
          ],
        },
      });

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.status).toHaveBeenCalledWith(STATUS_CODES.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Order items do not match reserved stock",
    });
  });

  it("should handle payment failure and publish event", async () => {
    // Arrange
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [
              { productId: 1, price: "10" },
              { productId: 2, price: "20" },
            ],
            status: "pending",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [
            { orderId: "123", productId: 1, reservedQuantity: 2 },
            { orderId: "123", productId: 2, reservedQuantity: 1 },
          ],
        },
      });

    mockedService.mockResolvedValue({
      paymentIntentId: null,
      status: "failed",
      clientSecret: null,
    });

    mockedPublishEvent.mockResolvedValue(undefined);

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.json).toHaveBeenCalledWith({ status: "failed" });
    expect(mockedPublishEvent).toHaveBeenCalledWith(
      "payment_service",
      "payment_failure",
      "payment_failure",
      { orderId: "123" }
    );
  });

  it("should handle specific error: order not found for reserved stock", async () => {
    // Arrange
    // Mock successful order fetch (first API call)
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [{ productId: 1, price: "10" }],
          status: "pending",
        },
      },
    });

    // Mock 404 error for reserved stock (second API call)
    mockedAxios.get.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 404,
        statusText: "Not Found",
        data: null,
      },
      request: {},
      config: {},
      message: "Request failed with status code 404",
    });

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.status).toHaveBeenCalledWith(STATUS_CODES.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "No reserved stock found for order ID 123",
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2); // Two API calls
  });

  it("should handle generic uncaught error", async () => {
    // Arrange
    mockedAxios.get.mockRejectedValue(new Error("Network error"));

    // Act
    await processPaymentAndStoreDetailsController(
      req as Request,
      res as Response,
      mockNext
    );

    // Assert
    expect(res.status).toHaveBeenCalledWith(STATUS_CODES.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Error processing payment",
      error: "Network error",
    });
  });
});
