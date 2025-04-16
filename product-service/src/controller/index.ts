import { Request, Response } from "express";
import expressAsyncHandler from "express-async-handler";
import {
  createProductService,
  deleteProductService,
  getAllProductsService,
  getProductByIdService,
  getProductBySlugService,
  updateProductService,
} from "../service";
import { STATUS_CODES } from "../constants";
import { publishEvent } from "../rabbitmq/publisher";
import redis from "../utils/redis";
import axios from "axios";
import { INVENTORY_SERVICE_URL } from "../config/apiEndpoints";
import logger from "../utils/logger";

interface StockData {
  productId: number;
  stock: number;
}

export const createProductController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, price, slug } = req.body;
    try {
      const createProduct = await createProductService({
        name,
        price,
        slug,
      });
      try {
        await publishEvent(
          "product_service",
          "product_created",
          "product created",
          createProduct
        );
      } catch (eventError) {
        logger.error(`❌ Failed to publish ProductCreated event:`, eventError);
      }

      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "Product created successfully",
        data: createProduct,
      });
    } catch (error: unknown) {
      logger.error(error);
      if (error instanceof Error) {
        if (
          error.message === "Slug already exists. Please use a different slug."
        ) {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: error.message,
            data: null,
          });
          return;
        }
      }

      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
    }
  }
);

export const getAllProductsController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    try {
      const { products, totalProducts } = await getAllProductsService(
        page,
        limit
      );

      // Fetch stock from Redis for all products
      const productIds = products.map((product) => product.id.toString());
      const redisKeys = productIds.map((id) => `stock:${id}`);
      let stockValues: (string | null)[] = [];

      try {
        stockValues = await redis.mget(...redisKeys); // Batch fetch from Redis
      } catch (redisError) {
        logger.error("Error fetching stock from Redis:", redisError);
        stockValues = Array(productIds.length).fill(null); // Fallback to null for all products
      }

      // Check if any stock is missing from Redis
      const hasMissingStock = stockValues.some((value) => value === null);

      //Fetch all stock from inventory service if any stock is missing
      let stockMap: Record<string, number> = {};
      if (hasMissingStock) {
        try {
          const stockResponse = await axios.get(
            `${INVENTORY_SERVICE_URL}/stocks`
          );
          if (stockResponse.status !== STATUS_CODES.OK) {
            throw new Error(
              `Inventory service responded with status: ${stockResponse.status}`
            );
          }
          const stockData: StockData[] = stockResponse.data.data || [];

          // Convert stock data to a map for easier lookup
          stockData.forEach((item) => {
            stockMap[item.productId.toString()] = item.stock;
          });

          logger.info("🟢 Fetched all stock from Inventory Service");

          // Cache all fetched stock in Redis
          const redisSetPromises = Object.entries(stockMap).map(
            ([productId, stock]) =>
              redis.setex(`stock:${productId}`, 300, stock.toString())
          );
          await Promise.all(redisSetPromises);
        } catch (inventoryError) {
          logger.error(
            "Error fetching stock from Inventory Service:",
            inventoryError
          );
          // Fallback: Set stock to 0 for all products if inventory service fails
          productIds.forEach((productId) => {
            stockMap[productId] = stockMap[productId] ?? "Unavailable";
          });
        }
      }

      // Combine Redis and inventory service data
      const productsWithStock = products.map((product, index) => {
        const productId = product.id.toString();
        let stock: number;

        if (stockValues[index] !== null) {
          // Stock was found in Redis
          stock = parseInt(stockValues[index]!, 10);
          logger.info(
            `🔵 Stock fetched from Redis for product ${productId}: ${stock}`
          );
        } else {
          // Stock was fetched from inventory service (or fallback)
          stock = stockMap[productId] ?? 0; // Default to 0 if not found
          logger.info(
            `🟢 Stock fetched for product ${productId}: ${stock} (from Inventory or fallback)`
          );
        }

        return {
          ...product.toJSON(),
          stock,
        };
      });

      // Send response
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Products fetched successfully",
        data: productsWithStock,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalProducts / limit),
          totalProducts,
        },
      });
    } catch (error) {
      logger.error(error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
    }
  }
);

export const updateProductController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    const { name, price, slug } = req.body;
    try {
      const updateProduct = await updateProductService({
        name,
        price,
        slug,
        id,
      });
      try {
        await publishEvent(
          "product.events",
          "product.updated",
          "product_updated",
          {
            updateProduct,
          },
          "direct"
        );
      } catch (eventError) {
        logger.error(`❌ Failed to publish ProductCreated event:`, eventError);
      }

      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "Product updated successfully",
        data: updateProduct,
      });
    } catch (error: unknown) {
      logger.error(error);
      if (error instanceof Error) {
        if (error.message === "Slug already exists.") {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: error.message,
            data: null,
          });
          return;
        }
      }

      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
    }
  }
);

export const deleteProductController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    try {
      await deleteProductService(id);
      try {
        await publishEvent(
          "product_service",
          "product_deleted",
          "product deleted",
          { id }
        );
      } catch (eventError) {
        logger.error(`❌ Failed to publish Product Deleted event:`, eventError);
      }
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Product deleted successfully",
        data: null,
      });
    } catch (error) {
      logger.error(error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
      return;
    }
  }
);

export const getProductByIdController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    try {
      const product = await getProductByIdService(id);
      if (!product) {
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Product not found",
          data: null,
        });
        return;
      }
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Product fetched successfully",
        data: product,
      });
    } catch (error) {
      logger.error(error);

      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
    }
  }
);

export const getProductBySlugController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const slug = req.params.slug;
    try {
      const product = await getProductBySlugService(slug);
      if (!product) {
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: "Product not found",
          data: null,
        });
        return;
      }
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Product fetched successfully",
        data: product,
      });
      return;
    } catch (error) {
      logger.error(error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
      return;
    }
  }
);
