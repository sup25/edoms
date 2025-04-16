import { handlecreatePaymentIntent } from "../handler/handleCreatePaymentIntent";
import { handleStorePayment } from "../handler/handlerPaymentService";
import { TPaymentResponse } from "../types";

export async function processPaymentAndStoreDetailsService(
  orderId: string,
  userId: string,
  items: { productId: string; quantity: number; price: string }[]
) {
  // Calculate total amount in cents
  const amount = items.reduce((total, item) => {
    return total + Math.round(parseFloat(item.price) * 100) * item.quantity;
  }, 0);

  // Create a Payment Intent
  const result: TPaymentResponse = await handlecreatePaymentIntent(
    amount,
    orderId,
    userId
  );

  // Handle the case where payment creation failed
  if (result.status === "failed") {
    return {
      paymentIntentId: null,
      status: "failed",
      clientSecret: null,
    };
  }

  // Store payment in the database
  const status = result.status === "succeeded" ? "success" : "failed";
  await handleStorePayment(orderId, amount, result.paymentIntentId!, status);

  return {
    paymentIntentId: result.paymentIntentId,
    status,
    clientSecret: result.clientSecret,
  };
}
