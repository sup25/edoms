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

router.get(
  "/product/:id",
  validate(undefined, getProductByIdSchema),
  getProductByIdController
);

router.get(
  "/product/:slug",
  validate(undefined, GetProductBySlugParamsSchema),
  getProductBySlugController
);

export default router;
