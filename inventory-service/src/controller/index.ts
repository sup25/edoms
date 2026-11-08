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
import { EventType } from "@edoms/shared-events";
import sequelize from "../config/db";
import { publishToOutbox } from "../rabbitmq/outbox";

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
      /*
       * One transaction for the write AND the event. These used to be two:
       * the service committed the new stock, then this opened a second
       * transaction to publish. A crash in between committed the stock and
       * lost the event, so product-service's Redis cache kept serving the old
       * number with nothing left to correct it - the exact dual-write gap the
       * outbox pattern exists to close, and which the rest of this codebase
       * closes correctly.
       */
      const updatedStock = await sequelize.transaction(async (transaction) => {
        const updated = await updateProductStockService(
          { id, stock },
          transaction
        );

        await publishToOutbox(
          EventType.STOCK_UPDATED,
          { productId: id, stock: stock },
          transaction
        );

        return updated;
      });
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
