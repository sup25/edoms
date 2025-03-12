import { z } from "zod";
import { CreateOrderRequestSchema } from "../schemas/createorder.request.schema";

export type TCreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;
