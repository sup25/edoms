import Stripe from "stripe";
import logger from "../utils/logger";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is missing in the environment variables");
}

const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" });

export async function handlecreatePaymentIntent(
  amount: number,
  orderId: string,
  userId: string
) {
  try {
    logger.info("Creating PaymentIntent with:", { amount, orderId, userId });
    /* test to simulate a failed payment */
    /* if (orderId === "99") {
      return {
        paymentIntentId: null,
        status: "failed",
        clientSecret: null,
        error: "Simulated payment failure for testing",
      };
    } */
    const customer = await stripe.customers.create({
      name: "Test Customer",
      address: {
        line1: "123 Test Street",
        city: "Test City",
        state: "CA",
        country: "US",
        postal_code: "94105",
      },
      metadata: { userId },
    });

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency: "usd",
        payment_method_types: ["card"],
        customer: customer.id,
        metadata: { orderId, userId },
        description: `Payment for order ${orderId} by user ${userId}`,
      },
      { idempotencyKey: `payment-${orderId}` }
    );

    const confirmedPaymentIntent = await stripe.paymentIntents.confirm(
      paymentIntent.id,
      {
        payment_method:
          process.env.STRIPE_TEST_PAYMENT_METHOD || "pm_card_visa",
        off_session: true,
      }
    );

    logger.info("PaymentIntent Status:", confirmedPaymentIntent.status);

    return {
      paymentIntentId: confirmedPaymentIntent.id,
      status: confirmedPaymentIntent.status,
      clientSecret: confirmedPaymentIntent.client_secret,
    };
  } catch (error: any) {
    logger.error("Stripe error:", error);

    return {
      paymentIntentId: null,
      status: "failed",
      clientSecret: null,
      error:
        error.type === "idempotency_error"
          ? "StripeIdempotencyError"
          : error.message,
    };
  }
}
