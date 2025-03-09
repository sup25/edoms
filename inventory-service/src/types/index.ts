import { z } from "zod";
import { updateProductStocksSchema } from "../schemas/updateProductStock.schema";

export type TupdateProductStocks = z.infer<typeof updateProductStocksSchema>;
