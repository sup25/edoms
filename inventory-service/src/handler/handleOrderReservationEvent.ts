import Stock from "../model/stock.model";
import OrderReservation from "../model/orderReservation.model";
import { publishEvent } from "../rabbitmq/publisher";
import { subscribeEvent } from "../rabbitmq/subscriber";
import logger from "../utils/logger";

interface OrderCreatedEvent {
  orderId: number;
  items: { productId: number; quantity: number }[];
}

export async function handleOrderReservationEvent(
  eventType: string,
  event: OrderCreatedEvent
) {
  try {
    if (eventType === "order_created") {
      const { orderId, items } = event;

      for (const item of items) {
        const { productId, quantity } = item;
        const stockRecord = await Stock.findOne({ where: { productId } });
        logger.info(`Stock record for product ${productId}:`, stockRecord);

        if (!stockRecord) {
          logger.error(`Stock record not found for product ${productId}`);
          continue;
        }

        if (stockRecord.stock < quantity) {
          logger.error(
            `Insufficient stock for product ${productId}. Required: ${quantity}, Available: ${stockRecord.stock}`
          );

          continue;
        }

        await stockRecord.decrement("stock", { by: quantity });
        await stockRecord.reload();
        logger.info(
          `Updated stock for product ${productId}: ${stockRecord.stock}`
        );

        await publishEvent(
          "inventory_service",
          "stock_decrement",
          "Stock Decrement",
          { productId }
        );

        const existingReservation = await OrderReservation.findOne({
          where: { orderId, productId },
        });

        if (existingReservation) {
          await existingReservation.update({
            reservedQuantity: quantity,
            status: "pending",
          });
          logger.info(
            `Updated reservation for order ${orderId}, product ${productId} with quantity ${quantity}`
          );
        } else {
          await OrderReservation.create({
            orderId,
            productId,
            reservedQuantity: quantity,
            status: "pending",
          });
          logger.info(
            `Created reservation for order ${orderId}, product ${productId} with quantity ${quantity}`
          );
        }
      }
      logger.info(`Processed OrderCreated event for order ${orderId}`);
    } else {
      logger.error(`Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    logger.error("Error handling order event:", error);
    throw error;
  }
}

export async function startOrderReservationEventService() {
  await subscribeEvent(
    "order_service",
    "create_order",
    "direct",
    async (eventType: string, data: any) => {
      logger.info(`Received event: ${eventType}`, data);
      await handleOrderReservationEvent(eventType, data);
    }
  );

  logger.info("Order reservation service started");
}
