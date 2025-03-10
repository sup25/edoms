import { Request, Response } from "express";
import expressAsyncHandler from "express-async-handler";
import {
  createProductService,
  deleteProductService,
  getAllProductsService,
  getProductBySlugService,
  updateProductService,
} from "../service";
import { STATUS_CODES } from "../constants";
import { publishEvent } from "../rabbitmq/publisher";
import redis from "../utils/redis";
import axios from "axios";
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || "http://localhost:5002/api/v1";

export const createProductController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, price, slug } = req.body;
    try {
      const createProduct = await createProductService({
        name,
        price,
        slug,
      });

      await publishEvent("product.events", "ProductCreated", createProduct);

      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "Product created successfully",
        data: createProduct,
      });
    } catch (error: unknown) {
      console.error(error);
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
    try {
      const products = await getAllProductsService();
      const productsWithStock = await Promise.all(
        products.map(async (product) => {
          const productId = product.id.toString();
          let stock: string | null = await redis.get(`stock:${productId}`);

          if (!stock) {
            try {
              //  Fetch stock from Inventory Service if not in Redis
              const stockResponse = await axios.get(
                `${INVENTORY_SERVICE_URL}/stock/${productId}`
              );
              stock = stockResponse.data.data?.toString() || "0"; // Convert to string for Redis

              //  Store stock in Redis with expiration time (e.g., 5 min)
              await redis.setex(`stock:${productId}`, 300, stock!);

              console.log(
                `🟢 Stock fetched from Inventory Service for product ${productId}: ${stock}`
              );
            } catch (error) {
              // Handle axios or inventory service error
              console.error(
                `❌ Error fetching stock for product ${productId}:`,
                error instanceof Error ? error.message : String(error)
              );
              stock = "0"; // Fallback to "0" as a string since Redis expects strings
            }
          } else {
            console.log(
              `🔵 Stock fetched from Redis for product ${productId}: ${stock}`
            );
          }

          // Convert stock to number, default to 0 if stock is null
          const stockValue = stock !== null ? parseInt(stock, 10) : 0;

          // Return product data with stock
          return {
            ...product.toJSON(),
            stock: stockValue,
          };
        })
      );

      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Products fetched successfully",
        data: productsWithStock,
      });
    } catch (error) {
      console.error(error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
    }
  }
);

/* export const getAllProductsController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    try {
      const products = await getAllProductsService();
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Products fetched successfully",
        data: products,
      });
    } catch (error) {
      console.error(error);
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
    }
  }
); */

export const updateProductController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params.id);
    const { name, price, slug, initialStock } = req.body;
    try {
      const updateProduct = await updateProductService({
        name,
        price,
        slug,
        id,
      });
      await publishEvent("product.events", "ProductUpdated", updateProduct);

      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "Product updated successfully",
        data: updateProduct,
      });
    } catch (error: unknown) {
      console.error(error);
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
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Product deleted successfully",
        data: null,
      });
    } catch (error) {
      console.error(error);
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
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Product fetched successfully",
        data: product,
      });
    } catch (error) {
      console.error(error);
      if (error instanceof Error) {
        if (error.message === "Product not found") {
          res.status(STATUS_CODES.NOT_FOUND).json({
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
