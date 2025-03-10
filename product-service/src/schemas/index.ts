import { z } from "zod";

export const CreateProductSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  price: z.number().min(1, "Price must be at least 1"),
  slug: z.string().min(6, "Slug must be at least 6 characters long"),
});
export const UpdateProductBodySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  price: z.number().min(1, "Price must be at least 1"),
  slug: z.string().min(6, "Slug must be at least 6 characters long"),
});

export const UpdateProductParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a valid integer").transform(Number),
});

export const DeleteProductParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a valid integer").transform(Number),
});

export const GetProductBySlugParamsSchema = z.object({
  slug: z.string().min(6, "Slug must be at least 6 characters long"),
});
