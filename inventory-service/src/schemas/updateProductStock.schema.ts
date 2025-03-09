import { z } from "zod";

export const updateProductStocksSchema = z.object({
  id: z.number().positive().int(),
  stock: z.number(),
});
