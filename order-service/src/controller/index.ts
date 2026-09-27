import expressAsyncHandler from "express-async-handler";
import { Request, Response } from "express";
import { STATUS_CODES } from "../constants";
import {
  createOrderService,
  getOrderDetailsByIdService,
  getOrderStatusByIdService,
} from "../service";
import { randomUUID } from "crypto";
import { EventType } from "@edoms/shared-events";
import sequelize from "../config/db";
import { publishToOutbox } from "../rabbitmq/outbox";
import logger from "../utils/logger";
import ProductProjection from "../model/productProjection.model";

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

    /*
     * Look the products up LOCALLY.
     *
     * This used to be one HTTP call to product-service per item, plus a bulk
     * call to inventory-service to pre-check stock. Both sat on the write
     * path, so no order could be accepted while either service was down.
     *
     * Prices now come from a local projection kept current by
     * product.created / product.updated / product.deleted.
     */
    const orderItems: any[] = [];

    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: `Invalid quantity for product ${item.productId}`,
          data: null,
        });
        return;
      }

      const product = await ProductProjection.findByPk(item.productId);

      if (!product) {
        // Either the product does not exist, or its creation event has not
        // been projected yet. Both are a client-visible 404 here.
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: `Product with ID ${item.productId} not found`,
          data: null,
        });
        return;
      }

      orderItems.push({
        productId: product.productId,
        quantity: item.quantity,
        name: product.name,
        price: product.price,
      });
    }

    /*
     * Stock is deliberately NOT checked here.
     *
     * inventory-service decides, with a conditional
     * `UPDATE ... WHERE stock >= :qty` that cannot oversell (Phase 3). If it
     * cannot satisfy the order it publishes inventory.reservation.failed and
     * the order is marked failed. Checking here as well would be a second,
     * racy opinion: stock can change between the check and the reservation.
     */

    // Step 4: Create the order using the service
    try {
      /*
       * The order row and the event that announces it are written in ONE
       * transaction. Before Phase 4 these were separate operations, so a crash
       * between them left an order nothing ever reacted to - stuck pending,
       * no stock reserved, no error anywhere (defect #10).
       *
       * The relay publishes the outbox row immediately afterwards.
       */
      const correlationId = randomUUID();
      const result = await sequelize.transaction(async (transaction) => {
        const created = await createOrderService(
          { userId, items: orderItems },
          transaction
        );

        const eventData = {
          orderId: created.order.id,
          userId: created.order.userId,
          items: orderItems.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            total: item.quantity * item.price,
          })),
          status: created.order.status,
          createdAt: created.order.createdAt,
          totalAmount: created.order.totalAmount,
        };

        await publishToOutbox(EventType.ORDER_CREATED, eventData, transaction, {
          correlationId,
        });

        return created;
      });

      /*
       * 202, not 201. The order has been accepted, not completed: stock is
       * not yet reserved and payment has not run. The client polls
       * GET /orderStatus/:id, or watches for the status to settle.
       */
      res.status(STATUS_CODES.ACCEPTED).json({
        success: true,
        message: "Order accepted and is being processed",
        data: { ...result.order, statusUrl: `/api/v1/orderStatus/${result.order.id}` },
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
