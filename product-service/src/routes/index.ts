import express from "express";
import {
  createProductController,
  deleteProductController,
  getAllProductsController,
  getProductByIdController,
  getProductBySlugController,
  updateProductController,
} from "../controller";
import { validate } from "../middleware/validateRequest";
import {
  CreateProductSchema,
  DeleteProductParamsSchema,
  getProductByIdSchema,
  GetProductBySlugParamsSchema,
  UpdateProductBodySchema,
  UpdateProductParamsSchema,
} from "../validations";
import { requireAdmin } from "../middleware/requireAdmin";

const router = express.Router();

router.post(
  "/createproduct",
  requireAdmin,
  validate(CreateProductSchema),
  createProductController
);

router.get("/products", getAllProductsController);

router.put(
  "/updateproduct/:id",
  requireAdmin,
  validate(UpdateProductBodySchema, UpdateProductParamsSchema),
  updateProductController
);

router.delete(
  "/deleteproduct/:id",
  validate(undefined, DeleteProductParamsSchema),
  requireAdmin,
  deleteProductController
);

/*
 * The slug lookup lives under its own path segment, not `/product/:slug`.
 * Both routes are one segment wide, so Express matched whichever registered
 * first - `/product/:id` - and every slug request died in `getProductByIdSchema`
 * as a 400 "Validation error". The controller below was unreachable.
 *
 * Dispatching one `/product/:idOrSlug` on "is it all digits" was the other
 * option, but slugs only have to be 6 characters, so "123456" is a legal slug
 * that would route to the id lookup forever. A distinct path has no such
 * ambiguity.
 */
router.get(
  "/product/slug/:slug",
  validate(undefined, GetProductBySlugParamsSchema),
  getProductBySlugController
);

router.get(
  "/product/:id",
  validate(undefined, getProductByIdSchema),
  getProductByIdController
);

export default router;
