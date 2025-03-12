import express from "express";
import { createOrderController } from "../controller";
import { requireUser } from "../middleware/ValidateUser";
import { validate } from "../middleware/validateRequest";
import { CreateOrderRequestSchema } from "../schemas/createorder.request.schema";
const router = express.Router();

router.post(
  "/createorder",
  requireUser,
  validate(CreateOrderRequestSchema),
  createOrderController
);

export default router;
