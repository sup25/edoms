import { z } from "zod";

export const CreateProductSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters long"),
  price: z.number().min(1, "Price must be at least 1"),
  slug: z.string().min(6, "Slug must be at least 6 characters long"),
  /*
   * Stock is not a product column - inventory-service owns it - but it has to
   * be settable here, because the only way inventory hears about a new product
   * is the `product created` event. Without this field the event carried no
   * stock, inventory defaulted to 0, and every new product needed a second
   * admin call to POST /updatestock before it could be ordered at all.
   *
   * Defaulted rather than required, so existing callers keep working; the
   * difference is that 0 is now a stated default instead of a missing field.
   */
  stock: z.number().int().nonnegative().optional().default(0),
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
export const getProductByIdSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a valid integer").transform(Number),
});

export const GetProductBySlugParamsSchema = z.object({
  slug: z.string().min(6, "Slug must be at least 6 characters long"),
});
