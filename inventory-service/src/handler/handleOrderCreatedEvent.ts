import Stock from "../model/inventory.model";
import OrderReservation from "../model/orderReservation.model";
import { publishEvent } from "../rabbitmq/publisher";

interface OrderCreatedEvent {
  action: string;
  orderId: number;
  items: { productId: number; quantity: number }[];
}

export async function handleOrderCreatedEvent(event: OrderCreatedEvent) {
  try {
    console.log("Processing order event:", event);
    console.log("event action:", event.action);

    if (!event.action) {
      console.error("Missing action in event:", event);
      return;
    }

    if (event.action === "order_created") {
      // Extract orderId and items directly from event
      const { orderId, items } = event;

      for (const item of items) {
        const { productId, quantity } = item;

        const stockRecord = await Stock.findOne({
          where: { productId },
        });
        console.log(`Stock record for product ${productId}:`, stockRecord);

        if (!stockRecord) {
          console.error(`Stock record not found for product ${productId}`);
          continue;
        }

        if (stockRecord.stock < quantity) {
          console.error(
            `Insufficient stock for product ${productId}. Required: ${quantity}, Available: ${stockRecord.stock}`
          );
          continue;
        }

        await stockRecord.decrement("stock", { by: quantity });
        await stockRecord.reload();
        console.log(
          `Updated stock for product ${productId}: ${stockRecord.stock}`
        );
        await publishEvent("stock_decrement", { productId });

        const existingReservation = await OrderReservation.findOne({
          where: { orderId, productId },
        });

        if (existingReservation) {
          await existingReservation.update({
            reservedQuantity: quantity,
            status: "pending",
          });
          console.log(
            `Updated reservation for order ${orderId}, product ${productId} with quantity ${quantity}`
          );
        } else {
          await OrderReservation.create({
            orderId,
            productId,
            reservedQuantity: quantity,
            status: "pending",
          });
          console.log(
            `Created reservation for order ${orderId}, product ${productId} with quantity ${quantity}`
          );
        }
      }

      console.log(`Processed OrderCreated event for order ${orderId}`);
    }
  } catch (error) {
    console.error("Error handling order event:", error);
    throw error;
  }
}
