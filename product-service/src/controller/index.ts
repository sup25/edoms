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

export const createProductController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, price, slug } = req.body;
    try {
      const createProduct = await createProductService({ name, price, slug });
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
