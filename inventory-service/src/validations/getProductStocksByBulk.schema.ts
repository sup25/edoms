import { z } from "zod";

export const getProductStocksBulkSchema = z.object({
  query: z.object({
    ids: z.string().transform((val) => val.split(",").map(Number)), // Expect comma-separated IDs
  }),
});
