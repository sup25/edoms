import { z } from "zod";
import {
  CreateProductSchema,
  UpdateProductBodySchema,
  UpdateProductParamsSchema,
} from "../validations";

export type TCreateProductRequest = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = z.object({
  name: UpdateProductBodySchema.shape.name,
  price: UpdateProductBodySchema.shape.price,
  slug: UpdateProductBodySchema.shape.slug,
  id: UpdateProductParamsSchema.shape.id,
});
export type TUpdateProductRequest = z.infer<typeof UpdateProductSchema>;
