import expressAsyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { STATUS_CODES } from "../constants";
import {
  getAllStockWithProductId,
  getProductStockById,
  updateProductStockService,
} from "../service";
import { publishEvent } from "../rabbitmq/publisher";

export const getProductStockController = expressAsyncHandler(
  async (req: Request, res: Response) => {
    const productId = Number(req.params.id);
    try {
      const productStock = await getProductStockById(productId);
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "product Stock fetched successfully",
        data: productStock,
      });
    } catch (error) {
      console.log(error);
      if (error instanceof Error) {
        if (error.message === `Stock not found for productId: ${productId}`) {
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
        message: "Error fetching product Stock",
        error: error,
      });
    }
  }
);
export const getAllStockController = expressAsyncHandler(
  async (req: Request, res: Response) => {
    try {
      const allStock = await getAllStockWithProductId();
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "product Stock fetched successfully",
        data: allStock,
      });
    } catch (error) {
      console.log(error);

      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error fetching product Stock",
        error: error,
      });
    }
  }
);

export const updateProductStockController = expressAsyncHandler(
  async (req: Request, res: Response) => {
    const { id, stock } = req.body;
    try {
      const updatedStock = await updateProductStockService({ id, stock });
      await publishEvent("StockUpdated", {
        productId: id,
        stock: stock,
      });
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "product Stock updated successfully",
        data: updatedStock,
      });
    } catch (error) {
      console.log(error);
      if (error instanceof Error) {
        if (error.message === `Stock not found for productId: ${id}`) {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: error.message,
            data: null,
          });
          return;
        }
        if (error.message === "Stock cannot be negative") {
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
        message: "Error updating product Stock",
        error: error,
      });
    }
  }
);
