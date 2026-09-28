import crypto from "crypto";
import express from "express";
import request from "supertest";

process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

import { stripeWebhookController } from "../controller/stripeWebhook";
import Payment from "../model/payment.model";
import ProcessedWebhook from "../model/processedWebhook.model";
import { publishToOutbox } from "../rabbitmq/outbox";
import sequelize from "../config/db";

jest.mock("../model/payment.model", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock("../model/processedWebhook.model", () => ({
  __esModule: true,
  default: { findOrCreate: jest.fn() },
}));
jest.mock("../rabbitmq/outbox", () => ({
  publishToOutbox: jest.fn().mockResolvedValue("evt-1"),
  startOutboxRelay: jest.fn(),
  stopOutboxRelay: jest.fn(),
}));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockedFindOrCreate = ProcessedWebhook.findOrCreate as unknown as jest.Mock;
const mockedPaymentFindOne = Payment.findOne as unknown as jest.Mock;
const mockedPaymentCreate = Payment.create as unknown as jest.Mock;
const mockedOutbox = publishToOutbox as jest.Mock;

const SECRET = "whsec_test_secret";

/** Builds the `stripe-signature` header the way Stripe does. */
function sign(payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function stripeEvent(type: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_test_1",
    type,
    data: {
      object: {
        id: "pi_test_1",
        amount: 3998,
        metadata: { orderId: "42" },
        ...overrides,
      },
    },
  });
}

describe("POST /webhooks/stripe", () => {
  let app: express.Express;

  beforeAll(() => {
    jest
      .spyOn(sequelize, "transaction")
      .mockImplementation((async (cb: any) => cb({})) as any);

    app = express();
    // raw, exactly as index.ts mounts it: the signature is over the bytes.
    app.post(
      "/webhooks/stripe",
      express.raw({ type: "application/json" }),
      stripeWebhookController
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindOrCreate.mockResolvedValue([{}, true]);
    mockedPaymentFindOne.mockResolvedValue(null);
  });

  it("publishes payment.succeeded for a signed payment_intent.succeeded", async () => {
    const payload = stripeEvent("payment_intent.succeeded");
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockedOutbox).toHaveBeenCalledWith(
      "payment.succeeded",
      expect.objectContaining({ orderId: "42" }),
      expect.anything()
    );
  });

  it("publishes payment.failed for a declined charge", async () => {
    const payload = stripeEvent("payment_intent.payment_failed");
    await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(mockedOutbox).toHaveBeenCalledWith(
      "payment.failed",
      expect.objectContaining({ orderId: "42" }),
      expect.anything()
    );
  });

  it("rejects an unsigned request", async () => {
    // Without this, anyone who can reach the port can tell us a charge
    // succeeded and have an order confirmed for free.
    const payload = stripeEvent("payment_intent.succeeded");
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(400);
    expect(mockedOutbox).not.toHaveBeenCalled();
  });

  it("rejects a signature made with the wrong secret", async () => {
    const payload = stripeEvent("payment_intent.succeeded");
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload, "whsec_not_ours"))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(400);
    expect(mockedOutbox).not.toHaveBeenCalled();
  });

  it("rejects a body that was altered after signing", async () => {
    const payload = stripeEvent("payment_intent.succeeded");
    const signature = sign(payload);
    const tampered = payload.replace('"orderId":"42"', '"orderId":"43"');

    const res = await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", signature)
      .set("content-type", "application/json")
      .send(tampered);

    expect(res.status).toBe(400);
    expect(mockedOutbox).not.toHaveBeenCalled();
  });

  it("does nothing the second time Stripe delivers the same event", async () => {
    // Stripe retries for up to three days, so this is routine, not an edge case.
    mockedFindOrCreate.mockResolvedValue([{}, false]);

    const payload = stripeEvent("payment_intent.succeeded");
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(mockedOutbox).not.toHaveBeenCalled();
    expect(mockedPaymentCreate).not.toHaveBeenCalled();
  });

  it("leaves an existing payment row alone", async () => {
    // The synchronous path may have recorded it already; both agree.
    mockedPaymentFindOne.mockResolvedValue({ orderId: "42", status: "success" });

    const payload = stripeEvent("payment_intent.succeeded");
    await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(mockedPaymentCreate).not.toHaveBeenCalled();
    expect(mockedOutbox).toHaveBeenCalled();
  });

  it("acknowledges an event type it does not act on", async () => {
    // A 200 stops Stripe retrying something we will never handle.
    const payload = stripeEvent("payment_intent.created");
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockedOutbox).not.toHaveBeenCalled();
  });

  it("acknowledges an event with no orderId rather than retrying forever", async () => {
    const payload = stripeEvent("payment_intent.succeeded", { metadata: {} });
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockedOutbox).not.toHaveBeenCalled();
  });

  it("answers 500 so Stripe retries when the transaction fails", async () => {
    mockedOutbox.mockRejectedValueOnce(new Error("broker down"));

    const payload = stripeEvent("payment_intent.succeeded");
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("stripe-signature", sign(payload))
      .set("content-type", "application/json")
      .send(payload);

    expect(res.status).toBe(500);
  });
});
