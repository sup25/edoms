import { z } from "zod";

export const PaymentResponseSchema = z.object({
  paymentIntentId: z.string().nullable(),
  status: z.string(),
  clientSecret: z.string().nullable(),
});
