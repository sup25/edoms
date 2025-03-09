import { z } from "zod";

export const getProductStocksSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a valid integer").transform(Number),
});
