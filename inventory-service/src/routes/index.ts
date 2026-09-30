import express from "express";
import {
  getStockWithProductIdController,
  getOrderReservationsByIdController,
  getOrderReservationsController,
  getProductStockController,
  updateProductStockController,
} from "../controller";
import { requireAdmin } from "../middleware/requireAdmin";
import { requireService } from "../middleware/requireService";
import { validate } from "../middleware/validateRequest";
import { getProductStocksSchema } from "../validations/getProductStocks.schema";
import { updateProductStocksSchema } from "../validations/updateProductStock.schema";

const router = express.Router();

/*
 * Every read here was open. `/reservedstocks` in particular returned EVERY
 * order reservation in the system - order ids, quantities, statuses - to
 * anyone who could reach the port.
 *
 * They are not public data, but they are not user-facing either: the stock
 * reads exist so product-service can warm its cache, and the reservation
 * reads for operators. So both are behind `requireService`, which accepts a
 * peer service's shared token or an admin JWT.
 */
router.get(
  "/stock/:id",
  requireService,
  validate(undefined, getProductStocksSchema),
  getProductStockController
);

router.get("/stocks", requireService, getStockWithProductIdController);
router.get("/reservedstocks", requireService, getOrderReservationsController);
router.get("/reservedstock/:id", requireService, getOrderReservationsByIdController);

router.post(
  "/updatestock",
  requireAdmin,
  validate(updateProductStocksSchema),
  updateProductStockController
);

export default router;
