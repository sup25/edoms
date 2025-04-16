import express from "express";
import {
  getStockWithProductIdController,
  getOrderReservationsByIdController,
  getOrderReservationsController,
  getProductStockController,
  updateProductStockController,
} from "../controller";
import { requireAdmin } from "../middleware/requireAdmin";
import { validate } from "../middleware/validateRequest";
import { getProductStocksSchema } from "../validations/getProductStocks.schema";
import { updateProductStocksSchema } from "../validations/updateProductStock.schema";

const router = express.Router();
router.get(
  "/stock/:id",
  validate(undefined, getProductStocksSchema),
  getProductStockController
);

router.get("/stocks", getStockWithProductIdController);
router.get("/reservedstocks", getOrderReservationsController);
router.get("/reservedstock/:id", getOrderReservationsByIdController);

router.post(
  "/updatestock",
  requireAdmin,
  validate(updateProductStocksSchema),
  updateProductStockController
);

export default router;
