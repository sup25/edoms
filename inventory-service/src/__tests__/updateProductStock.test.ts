import connectdb from "../config/db";
import { updateProductStockController } from "../controller";
import { publishEvent } from "../rabbitmq/publisher";
import { updateProductStockService } from "../service";
import { Request, Response, NextFunction } from "express";

// Mock the Stock model
interface MockStockInstance {
  productId: number;
  stock: number;
  low_stock_threshold: number;
  save: jest.Mock<Promise<MockStockInstance>, []>;
  toJSON: jest.Mock;
}
jest.mock("../model/inventory.model", () => {
  const mockStockInstance = {
    productId: 1,
    stock: 0,
    low_stock_threshold: 5,
    save: jest.fn(),
    toJSON: jest.fn(),
  };

  const mockModel = {
    findByPk: jest.fn(),
    create: jest.fn(),
  };

  return {
    __esModule: true,
    default: Object.assign(
      jest.fn(() => mockStockInstance),
      mockModel
    ),
  };
});

// Mock the OrderReservation model to avoid initialization errors
jest.mock("../model/orderReservation.model", () => {
  return {
    __esModule: true,
    default: jest.fn(() => ({
      // Mock any methods or properties used by the service
    })),
  };
});

// Mock other dependencies
jest.mock("../config/db");
jest.mock("../rabbitmq/publisher", () => ({
  publishEvent: jest.fn().mockResolvedValue(true),
}));
jest.mock("../service", () => ({
  updateProductStockService: jest.fn(),
}));

interface MockRequest extends Request {
  body: { id: number; stock: number };
}

interface MockResponse extends Response {
  status: jest.Mock;
  json: jest.Mock;
}

describe("Product Stock Management", () => {
  let mockTransaction: any;
  let mockReq: MockRequest;
  let mockRes: MockResponse;
  let mockNext: NextFunction;

  const MockStock = jest.requireMock("../model/inventory.model").default;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction = {
      LOCK: { UPDATE: "UPDATE" },
    };
    mockReq = { body: { id: 1, stock: 10 } } as MockRequest;
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as MockResponse;
    mockNext = jest.fn();
  });

  describe("updateProductStockService", () => {
    it("should update existing stock successfully", async () => {
      const mockStockInstance = {
        productId: 1,
        stock: 5,
        low_stock_threshold: 5,
        save: jest.fn(),
        toJSON: jest.fn().mockReturnValue({
          productId: 1,
          stock: 10,
          low_stock_threshold: 5,
        }),
      };

      // Mock static method findByPk
      MockStock.findByPk.mockResolvedValue(mockStockInstance);
      mockStockInstance.save.mockResolvedValue(mockStockInstance);

      // Mock the transaction
      (connectdb.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockTransaction);
      });

      // Since we're testing the real service, unmock it for this test
      jest.unmock("../service");
      const { updateProductStockService } = jest.requireActual("../service");

      // Call the service
      const result = await updateProductStockService({ id: 1, stock: 10 });

      // Assertions
      expect(MockStock.findByPk).toHaveBeenCalledWith(1, {
        transaction: mockTransaction,
        lock: "UPDATE",
      });
      expect(mockStockInstance.stock).toBe(10);
      expect(mockStockInstance.save).toHaveBeenCalledWith({
        transaction: mockTransaction,
      });
      expect(result).toEqual(mockStockInstance);
    });

    it("should handle concurrent updates without race conditions", async () => {
      const mockStockInstance: MockStockInstance = {
        productId: 1,
        stock: 5,
        low_stock_threshold: 5,
        save: jest.fn().mockImplementation(function (this: MockStockInstance) {
          // Simulate saving to the database
          this.stock += 10; // Increment stock by 10 (simulate update)
          return Promise.resolve(this);
        }),
        toJSON: jest.fn().mockReturnValue({
          productId: 1,
          stock: 15,
          low_stock_threshold: 5,
        }),
      };

      // Mock findByPk to simulate a locked row
      MockStock.findByPk.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve(mockStockInstance), 100); // Simulate a delay
        });
      });

      // Mock the transaction
      (connectdb.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockTransaction);
      });

      jest.unmock("../service");
      const { updateProductStockService } = jest.requireActual("../service");

      // Simulate two concurrent updates
      const update1 = updateProductStockService({ id: 1, stock: 10 });
      const update2 = updateProductStockService({ id: 1, stock: 15 });

      const [result1, result2] = await Promise.all([update1, update2]);

      // Assertions
      expect(MockStock.findByPk).toHaveBeenCalledWith(1, {
        transaction: mockTransaction,
        lock: "UPDATE",
      });
      expect(mockStockInstance.save).toHaveBeenCalledTimes(2); // Ensure both updates were saved
      expect(result1).toEqual(mockStockInstance);
      expect(result2).toEqual(mockStockInstance);
    });

    it("should throw error for negative stock", async () => {
      const mockStockInstance = {
        productId: 1,
        stock: 5,
        low_stock_threshold: 5,
        save: jest.fn(),
        toJSON: jest.fn().mockReturnValue({
          productId: 1,
          stock: 5,
          low_stock_threshold: 5,
        }),
      };

      MockStock.findByPk.mockResolvedValue(mockStockInstance);

      (connectdb.transaction as jest.Mock).mockImplementation(async (cb) => {
        return cb(mockTransaction);
      });

      jest.unmock("../service");
      const { updateProductStockService } = jest.requireActual("../service");

      await expect(
        updateProductStockService({ id: 1, stock: -5 })
      ).rejects.toThrow("Stock cannot be negative");
    });
  });

  describe("updateProductStockController", () => {
    it("should update stock and return success response", async () => {
      const mockStockInstance = {
        productId: 1,
        stock: 10,
        low_stock_threshold: 5,
        toJSON: jest.fn().mockReturnValue({
          productId: 1,
          stock: 10,
          low_stock_threshold: 5,
        }),
      };

      (updateProductStockService as jest.Mock).mockResolvedValue(
        mockStockInstance
      );
      (publishEvent as jest.Mock).mockResolvedValue(true);

      await updateProductStockController(mockReq, mockRes, mockNext);

      expect(updateProductStockService).toHaveBeenCalledWith({
        id: 1,
        stock: 10,
      });
      expect(publishEvent).toHaveBeenCalledWith(
        "inventory_service",
        "stock_updated",
        "Stock Updated",
        { productId: 1, stock: 10 }
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        message: "product Stock updated successfully",
        data: mockStockInstance,
      });
    });

    it("should handle stock not found error", async () => {
      (updateProductStockService as jest.Mock).mockRejectedValue(
        new Error("Stock not found for productId: 1")
      );

      await updateProductStockController(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Stock not found for productId: 1",
        data: null,
      });
    });

    it("should handle negative stock error", async () => {
      (updateProductStockService as jest.Mock).mockRejectedValue(
        new Error("Stock cannot be negative")
      );

      await updateProductStockController(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Stock cannot be negative",
        data: null,
      });
    });

    it("should handle internal server error", async () => {
      (updateProductStockService as jest.Mock).mockRejectedValue(
        new Error("Database error")
      );

      await updateProductStockController(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: "Internal Server Error",
        data: null,
      });
    });
  });
});
