import { z } from "zod";
import { CreateOrderRequestSchema } from "../validations/createorder.request.schema";

export type TCreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
