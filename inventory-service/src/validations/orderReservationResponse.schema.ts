import { z } from "zod";

export const orderReservationSchema = z.object({
  id: z.number().int().positive(),
  orderId: z.number().int().positive(),
  productId: z.number().int().positive(),
  reservedQuantity: z.number().int().positive(),
  status: z.enum(["pending", "confirmed", "released", "canceled"]),
  createdAt: z.string().datetime(), // Validates ISO 8601 datetime strings
  updatedAt: z.string().datetime(),
});
