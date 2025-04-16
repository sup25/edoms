import { Request, Response } from "express";
import axios from "axios";
import { processPaymentAndStoreDetailsService } from "../service";
import expressAsyncHandler from "express-async-handler";
import { STATUS_CODES } from "../constants";
import { orderUrl, reservedStockUrl } from "../config/apiEndpoints";
import { publishEvent } from "../rabbitmq/publisher";
import { calculateTotalAmount } from "../utils/calculateTotalAmount";
import { TPaymentResponse } from "../types";
import logger from "../utils/logger";

export const processPaymentAndStoreDetailsController = expressAsyncHandler(
  async (req: Request, res: Response) => {
    const { orderId, userId, items } = req.body;
    const orderIdStr = String(orderId);
    const amount = calculateTotalAmount(items);

    try {
      const orderResponse = await axios.get(`${orderUrl}/${orderIdStr}`);

      if (!orderResponse.data.success) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to fetch order status",
        });
        return;
      }
      if (!orderResponse.data) {
        res.status(STATUS_CODES.NOT_FOUND).json({
          success: false,
          message: `No reserved stock found for order ID ${orderIdStr}`,
        });
        return;
      }

      // Check reserved stock
      let reservedStockResponse;
      try {
        reservedStockResponse = await axios.get(
          `${reservedStockUrl}/${orderIdStr}`
        );
      } catch (error: any) {
        if (error.response.status === STATUS_CODES.NOT_FOUND) {
          res.status(STATUS_CODES.NOT_FOUND).json({
            success: false,
            message: `No reserved stock found for order ID ${orderIdStr}`,
          });
          return;
        }
        logger.error("Error fetching reserved stock:", error.message);
        res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Error fetching reserved stock",
        });
        return;
      }

      if (!reservedStockResponse.data.success) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Failed to fetch reserved stocks",
        });
        return;
      }
      // Fetch the order data
      const orderData = orderResponse.data.data;
      const orderItems = orderData.items;
      const orderStatus = orderResponse.data.data.status;

      if (orderStatus === "confirmed") {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Payment already processed for this order",
        });
        return;
      }

      // Ensure the price in the request matches the order data
      const isPriceValid = items.every(
        (item: { productId: number; price: number }) => {
          const orderItem = orderItems.find(
            (oItem: any) => oItem.productId === item.productId
          );

          return orderItem && parseFloat(orderItem.price) === item.price;
        }
      );

      if (!isPriceValid) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Price mismatch detected in order items",
        });
        return;
      }

      const reservedStocks = reservedStockResponse.data.data;
      const isValidOrder = items.every(
        (item: { productId: number; quantity: number; price: number }) => {
          const reservedItem = reservedStocks.find(
            (stock: any) =>
              String(stock.orderId) === orderIdStr &&
              stock.productId === item.productId
          );
          return (
            reservedItem && reservedItem.reservedQuantity === item.quantity
          );
        }
      );

      if (!isValidOrder) {
        res.status(STATUS_CODES.BAD_REQUEST).json({
          success: false,
          message: "Order items do not match reserved stock",
        });
        return;
      }

      // Process payment
      const result: TPaymentResponse =
        await processPaymentAndStoreDetailsService(orderIdStr, userId, items);

      if (result.status === "success") {
        await publishEvent(
          "payment_service",
          "payment_success",
          "payment_success",
          {
            orderId: orderIdStr,
            userId,
            items,
          }
        );
      }

      if (result.status === "failed") {
        await publishEvent(
          "payment_service",
          "payment_failure",
          "payment_failure",
          {
            orderId: orderIdStr,
          }
        );
      }

      res.json({
        status: result.status,
      });
    } catch (error) {
      logger.error("Controller error:", error);

      if (error instanceof Error) {
        if (error.message === "Order is confirmed but no payment found") {
          res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: "Inconsistent state: order confirmed without payment",
          });
          return;
        }

        if (
          error.message.includes(
            "Keys for idempotent requests can only be used with the same parameters"
          )
        ) {
          res.status(STATUS_CODES.CONFLICT).json({
            success: false,
            message: "Payment already processed with conflicting details",
          });
          return;
        }

        if (error.message === "Failed to create PaymentIntent") {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: "Payment creation failed",
          });
          return;
        }

        if (error.message === "Failed to store payment details") {
          res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: "Failed to store payment details",
          });
          return;
        }
      }

      // Generic fallback for unhandled errors
      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Error processing payment",
        error: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  }
);
