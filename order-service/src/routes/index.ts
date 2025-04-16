import express from "express";
import {
  createOrderController,
  getOrderDetailsByIdController,
  getOrderStatusByIdController,
} from "../controller";
import { requireUser } from "../middleware/ValidateUser";
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
router.get(
  "/order/:id",
  validate(undefined, getOrderDetailsRequest),
  getOrderDetailsByIdController
);
router.get(
  "/orderStatus/:id",
  validate(undefined, getOrderStatusRequestSchema),
  getOrderStatusByIdController
);

export default router;
