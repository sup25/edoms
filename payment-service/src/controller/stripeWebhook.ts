import type { Request, Response } from "express";
import Stripe from "stripe";
import { EventType } from "@edoms/shared-events";
import sequelize from "../config/db";
import Payment from "../model/payment.model";
import ProcessedWebhook from "../model/processedWebhook.model";
import { publishToOutbox } from "../rabbitmq/outbox";
import { addContext } from "@edoms/shared-observability";
import logger from "../utils/logger";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-02-24.acacia",
});

/**
 * Stripe webhook endpoint.
 *
 * Until now the outcome of a charge was taken solely from the synchronous
 * response to `paymentIntents.confirm`. If that response was lost - a timeout,
 * a crash between the charge and the publish, a deploy at the wrong moment -
 * the money moved and nothing downstream ever heard about it. The order sat in
 * `paid` limbo (the saga deliberately never expires `paid`, because money has
 * moved and a human should decide), and the customer had been charged for an
 * order that was never confirmed.
 *
 * Stripe's webhook is the authoritative record of what actually happened to
 * the charge, so it is what publishes the domain event now. The synchronous
 * path still publishes too - whichever arrives first wins and the other is a
 * no-op, which is the point of doing both.
 *
 * Authentication is the signature, not a token: Stripe cannot present one.
 * `express.raw` must be mounted for this route, because the signature is
 * computed over the exact bytes and a parsed-then-restringified body will not
 * match.
 */
export async function stripeWebhookController(
  req: Request,
  res: Response
): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Refusing is safer than accepting unverified instructions about money.
    logger.error("STRIPE_WEBHOOK_SECRET is not set; refusing webhook", {
      alert: "missing_webhook_secret",
    });
    res.status(503).json({ received: false });
    return;
  }

  const signature = req.header("stripe-signature");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      signature ?? "",
      secret
    );
  } catch (error) {
    // A bad signature means this did not come from Stripe. 400 tells Stripe
    // not to keep retrying something we will never accept.
    logger.warn("Rejected a Stripe webhook with an invalid signature", {
      reason: error instanceof Error ? error.message : String(error),
    });
    res.status(400).json({ received: false });
    return;
  }

  addContext({ stripeEventId: event.id, stripeEventType: event.type });

  const intent = event.data.object as Stripe.PaymentIntent;
  const orderId = intent?.metadata?.orderId;

  const outcome =
    event.type === "payment_intent.succeeded"
      ? "success"
      : event.type === "payment_intent.payment_failed"
      ? "failed"
      : null;

  if (!outcome) {
    // Acknowledge anything we do not act on, or Stripe retries it for days.
    res.status(200).json({ received: true, ignored: event.type });
    return;
  }

  if (!orderId) {
    logger.error(`Stripe ${event.type} carried no orderId in metadata`, {
      paymentIntentId: intent?.id,
    });
    // Still a 200: retrying will not add the metadata that was never set.
    res.status(200).json({ received: true, ignored: "no orderId" });
    return;
  }

  try {
    const published = await sequelize.transaction(async (transaction) => {
      /*
       * Claim the event first. A redelivery hits the primary key and rolls
       * back, so the work below happens exactly once.
       */
      const [, created] = await ProcessedWebhook.findOrCreate({
        where: { eventId: event.id },
        defaults: { eventId: event.id, eventType: event.type },
        transaction,
      });
      if (!created) return false;

      /*
       * The payment row may already exist from the synchronous path. Record
       * the charge if it does not, and let the existing row stand if it does -
       * Stripe and we agree on the outcome, and the row carries the intent id
       * either way.
       */
      const existing = await Payment.findOne({
        where: { orderId: String(orderId) },
        transaction,
      });

      if (!existing) {
        await Payment.create(
          {
            orderId: String(orderId),
            amount: intent.amount ?? 0,
            paymentId: intent.id,
            status: outcome,
          },
          { transaction }
        );
      }

      await publishToOutbox(
        outcome === "success"
          ? EventType.PAYMENT_SUCCEEDED
          : EventType.PAYMENT_FAILED,
        outcome === "success"
          ? { orderId: String(orderId), items: [] }
          : { orderId: String(orderId), reason: "payment_declined" },
        transaction
      );

      return true;
    });

    logger.info(
      published
        ? `Stripe ${event.type} applied for order ${orderId}`
        : `Stripe ${event.type} already applied for order ${orderId}, skipped`
    );

    res.status(200).json({ received: true, duplicate: !published });
  } catch (error) {
    /*
     * 500 so Stripe retries. The transaction rolled back, including the
     * ledger row, so the retry is not mistaken for a duplicate.
     */
    logger.error(`Failed to apply Stripe ${event.type} for order ${orderId}`, error);
    res.status(500).json({ received: false });
  }
}
