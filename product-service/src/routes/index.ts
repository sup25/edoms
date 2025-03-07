import express, { Request, Response } from "express";
import { createProductController } from "../controller";
import { validate } from "../middleware/validateRequest";
import { CreateProductSchema } from "../schemas/createProduct.schema";
import { requireAdmin } from "../middleware/requireAdmin";

const router = express.Router();

router.post(
  "/createproduct",
  requireAdmin,
  validate(CreateProductSchema),
  createProductController
);

export default router;
