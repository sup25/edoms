import expressAsyncHandler from "express-async-handler";
import axios from "axios";
import Redis from "ioredis";
import { Request, Response } from "express";
import { STATUS_CODES } from "../constants";
import {
  createOrderService,
  getOrderDetailsByIdService,
  getOrderStatusByIdService,
} from "../service";
import { publishEvent } from "../rabbitmq/publisher";
import { PRODUCT_SERVICE_URL, STOCK_SERVICE_URL } from "../config/apiEndpoints";
import logger from "../utils/logger";

const redis = new Redis();

interface OrderItem {
  productId: number;
  quantity: number;
}

export const createOrderController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { userId, items } = req.body;

    // Validate userId
    if (!userId || userId <= 0) {
      res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Invalid user ID",
        data: null,
      });
      return;
    }

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Items must be a non-empty array",
        data: null,
      });
      return;
    }

    // Step 1: Fetch products by their IDs
    const products: any[] = [];
    const productIds = items.map((item: OrderItem) => item.productId);

    for (const productId of productIds) {
      // Check Redis cache first
      const cachedProduct = await redis.get(`product:${productId}`);
      if (cachedProduct) {
        products.push(JSON.parse(cachedProduct));
      } else {
        try {
          const productResponse = await axios.get(
            `${PRODUCT_SERVICE_URL}/api/v1/product/${productId}`
          );

          if (!productResponse.data?.success) {
            res.status(STATUS_CODES.NOT_FOUND).json({
              success: false,
              message: `Product with ID ${productId} not found`,
            });
            return;
          }

          const product = productResponse.data?.data;
          products.push(product);

          // Cache the product in Redis (expires in 10 minutes)
          await redis.set(
            `product:${productId}`,
            JSON.stringify(product),
            "EX",
            600
          );
        } catch (error) {
          logger.error(`Error fetching product ${productId}:`, error);
          res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: `Error fetching product ${productId}`,
            data: null,
          });
          return;
        }
      }
    }

    // Step 2: Fetch stock details for the required products
    let stockData: any[] = [];
    try {
      // Ideally, modify the stock service to accept a list of productIds
      const stockResponse = await axios.get(
        `${STOCK_SERVICE_URL}/api/v1/stocks?productIds=${productIds.join(",")}`
      );

      if (!stockResponse.data?.success) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to fetch stock data",
          data: null,
        });
        return;
      }

      stockData = stockResponse.data.data || [];
    } catch (error) {
      logger.error("Error fetching stock details:", error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error fetching stock details",
        data: null,
      });
      return;
    }

    const orderItems: any[] = [];

    for (const item of items) {
      const product = products.find((p: any) => p.id === item.productId);
      const stock = stockData.find((s: any) => s.productId === item.productId);

      // Validate product existence
      if (!product) {
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: `Product with ID ${item.productId} not found`,
        });
        return;
      }

      // Validate stock existence
      if (!stock) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Stock information not found for product ${product.name}`,
          data: null,
        });
        return;
      }

      // Validate stock availability
      if (stock.stock < item.quantity) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Insufficient stock for product ${product.name}`,
          data: null,
        });
        return;
      }

      // Validate quantity
      if (item.quantity <= 0) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Invalid quantity for product ${product.name}`,
          data: null,
        });
        return;
      }

      // Add validated item to orderItems
      orderItems.push({
        productId: product.id,
        quantity: item.quantity,
        name: product.name,
        price: product.price,
      });
    }

    // Step 4: Create the order using the service
    try {
      const result = await createOrderService({ userId, items: orderItems });

      // Step 5: Publish the event
      const eventData = {
        orderId: result.order.id,
        userId: result.order.userId,
        items: orderItems.map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          total: item.quantity * item.price, // Ensure total is calculated
        })),
        status: result.order.status,
        createdAt: result.order.createdAt,
        totalAmount: result.order.totalAmount,
      };

      await publishEvent(
        "order_service",
        "create_order",
        "order_created",
        eventData
      );

      // Step 6: Send success response
      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "Order created successfully",
        data: result.order,
      });
    } catch (error) {
      logger.error("Error creating order:", error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to create order",
        data: null,
      });
    }
  }
);

export const getOrderDetailsByIdController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);

    try {
      const result = await getOrderDetailsByIdService(id);
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Order fetched successfully",
        data: result,
      });
      return;
    } catch (error) {
      logger.error("Error fetching order status:", error);
      if (error instanceof Error && error.message === "Order not found") {
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Order not found",
        });
        return;
      }
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to fetch order status",
        data: null,
      });
      return;
    }
  }
);

export const getOrderStatusByIdController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    try {
      const result = await getOrderStatusByIdService(id);
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Order status fetched successfully",
        data: result,
      });
    } catch (error) {
      logger.error("Error fetching order status:", error);
      if (error instanceof Error && error.message === "Order not found") {
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Order not found",
        });
        return;
      }
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Failed to fetch order status",
        data: null,
      });
      return;
    }
  }
);
