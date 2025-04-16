import { z } from "zod";
import { PaymentResponseSchema } from "../schemas/payment.response.schema";

export type TPaymentResponse = z.infer<typeof PaymentResponseSchema>;
