import expressAsyncHandler from "express-async-handler";
import axios from "axios";
import Redis from "ioredis";
import { Request, Response } from "express";
import { STATUS_CODES } from "../constants";
import { createOrderService } from "../service";
import { publishOrderEvent } from "../rabbitmq/publisher";

const redis = new Redis();

export const createOrderController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { userId, items } = req.body;

    if (!userId || userId <= 0) {
      res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Invalid user ID",
        data: null,
      });
      return;
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Items must be a non-empty array",
        data: null,
      });
      return;
    }

    // Define service URLs
    const PRODUCT_SERVICE_URL =
      process.env.PRODUCT_SERVICE_URL || "http://localhost:5001";
    const STOCK_SERVICE_URL =
      process.env.STOCK_SERVICE_URL || "http://localhost:5002";

    // Check Redis cache first for product data
    let products;
    const cachedProducts = await redis.get("products");

    if (cachedProducts) {
      products = JSON.parse(cachedProducts);
    } else {
      try {
        const productResponse = await axios.get(
          `${PRODUCT_SERVICE_URL}/api/v1/products`
        );

        if (!productResponse.data?.success) {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: "Failed to fetch products",
            data: null,
          });
          return;
        }

        products = productResponse.data?.data;

        // Store product data in Redis cache (expires in 10 minutes)
        await redis.set("products", JSON.stringify(products), "EX", 600);
      } catch (error) {
        console.error("Error fetching product details:", error);
        res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Error fetching product details",
          data: null,
        });
        return;
      }
    }

    // Fetch stock details from inventory service
    let stockData;
    try {
      const stockResponse = await axios.get(
        `${STOCK_SERVICE_URL}/api/v1/stocks`
      );
      if (!stockResponse.data.success) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to fetch stock data",
          data: null,
        });
        return;
      }
      stockData = stockResponse.data.data;
    } catch (error) {
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error fetching stock details",
        data: null,
      });
      return;
    }

    // Validate stock & combine product details
    const orderItems = [];

    for (const item of items) {
      const product = products.find((p: any) => p.id === item.productId);

      const stock = stockData.find((s: any) => s.productId === item.productId);

      if (!product) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Product with ID ${item.productId} not found`,
          data: null,
        });
      }

      if (!stock) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Stock information not found for product ${product.name}`,
          data: null,
        });
      }

      if (stock.stock < item.quantity) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Insufficient stock for product ${product.name}`,
          data: null,
        });
      }

      if (item.quantity <= 0) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Invalid quantity for product ${product.name}`,
          data: null,
        });
      }

      orderItems.push({
        productId: product.id,
        quantity: item.quantity,
        name: product.name,
        price: product.price,
      });
    }

    // Create the order using the service
    const result = await createOrderService({ userId, items: orderItems });

    const eventData = {
      orderId: result.order.id,
      userId: result.order.userId,
      items: orderItems.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      status: result.order.status,
      createdAt: result.order.createdAt,
    };

    await publishOrderEvent(eventData);

    res.status(STATUS_CODES.CREATED).json({
      success: true,
      message: "Order created successfully",
      data: result.order,
    });
  }
);
