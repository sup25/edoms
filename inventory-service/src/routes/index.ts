import express from "express";
import {
  getProductStockController,
  updateProductStockController,
} from "../controller";
import { requireAdmin } from "../middleware/requireAdmin";
import { validate } from "../middleware/validateRequest";
import { getProductStocksSchema } from "../schemas/getProductStocks.schema";
import { updateProductStocksSchema } from "../schemas/updateProductStock.schema";

const router = express.Router();
router.get(
  "/stock/:id",
  requireAdmin,
  validate(undefined, getProductStocksSchema),
  getProductStockController
);

router.post(
  "/stock",
  requireAdmin,
  validate(updateProductStocksSchema),
  updateProductStockController
);

export default router;
