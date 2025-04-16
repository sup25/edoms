import { z } from "zod";
import { updateProductStocksSchema } from "../validations/updateProductStock.schema";
import { orderReservationSchema } from "../validations/orderReservationResponse.schema";

export type TupdateProductStocks = z.infer<typeof updateProductStocksSchema>;
export type TOrderReservationResponse = z.infer<typeof orderReservationSchema>;
