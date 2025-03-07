import express from "express";
import {
  createProductController,
  deleteProductController,
  getAllProductsController,
  getProductBySlugController,
  updateProductController,
} from "../controller";
import { validate } from "../middleware/validateRequest";
import {
  CreateProductSchema,
  DeleteProductParamsSchema,
  GetProductBySlugParamsSchema,
  UpdateProductBodySchema,
  UpdateProductParamsSchema,
} from "../schemas";
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

router.get(
  "/getproduct/:slug",
  validate(undefined, GetProductBySlugParamsSchema),
  getProductBySlugController
);

export default router;
