import expressAsyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { STATUS_CODES } from "../constants";
import {
  getStockWithProductIdService,
  getOrderReservationsByIdService,
  getOrderReservationsService,
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
        message: "Internal server error",
        data: null,
      });
    }
  }
);
export const getStockWithProductIdController = expressAsyncHandler(
  async (req: Request, res: Response) => {
    try {
      const allStock = await getStockWithProductIdService();
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "product Stock fetched successfully",
        data: allStock,
      });
    } catch (error) {
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
      await publishEvent(
        "inventory_service",
        "stock_updated",
        "Stock Updated",
        {
          productId: id,
          stock: stock,
        }
      );
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "product Stock updated successfully",
        data: updatedStock,
      });
    } catch (error) {
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
        message: "Internal Server Error",
        data: null,
      });
    }
  }
);

export const getOrderReservationsController = expressAsyncHandler(
  async (req: Request, res: Response) => {
    try {
      const getOrderReservation = await getOrderReservationsService();
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "reserved order fetched successfully",
        data: getOrderReservation,
      });
    } catch (error) {
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error fetching reserved order",
        error: error,
      });
    }
  }
);

export const getOrderReservationsByIdController = expressAsyncHandler(
  async (req: Request, res: Response) => {
    try {
      const orderId = Number(req.params.id);
      const getOrderReservationsById = await getOrderReservationsByIdService(
        orderId
      );
      if (getOrderReservationsById.length === 0) {
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: `No reserved stock found for order ID ${orderId}`,
        });
        return;
      }
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "reserved stock fetched successfully",
        data: getOrderReservationsById,
      });
    } catch (error) {
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
      return;
    }
  }
);
