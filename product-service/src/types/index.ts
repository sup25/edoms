import { z } from "zod";
import { CreateProductSchema } from "../schemas/createProduct.schema";

export type TCreateProductRequest = z.infer<typeof CreateProductSchema>;
