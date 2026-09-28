import express from "express";
import {
  createOrderController,
  getOrderDetailsByIdController,
  getOrderStatusByIdController,
} from "../controller";
import { requireAuthenticated, requireUser } from "../middleware/ValidateUser";
import { validate } from "../middleware/validateRequest";
import {
  CreateOrderRequestSchema,
  getOrderDetailsRequest,
  getOrderStatusRequestSchema,
} from "../validations/createorder.request.schema";
const router = express.Router();

router.post(
  "/createorder",
  requireUser,
  validate(CreateOrderRequestSchema),
  createOrderController
);
/*
 * Both reads are guarded now. They had no middleware and no ownership check,
 * so any order was readable by guessing an integer - and Phase 5 made
 * /orderStatus/:id the way a client learns its own outcome, which made that
 * the main read path rather than an obscure one.
 *
 * `requireAuthenticated`, not `requireUser`: an admin has to be able to look
 * up a customer's order. Which rows each may see is decided in the service
 * layer, where the row is actually read.
 */
router.get(
  "/order/:id",
  requireAuthenticated,
  validate(undefined, getOrderDetailsRequest),
  getOrderDetailsByIdController
);
router.get(
  "/orderStatus/:id",
  requireAuthenticated,
  validate(undefined, getOrderStatusRequestSchema),
  getOrderStatusByIdController
);

export default router;
