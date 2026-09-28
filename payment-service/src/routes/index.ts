// routes/payment.route.ts
import { Router } from "express";
import { processPaymentAndStoreDetailsController } from "../controller";
import { requireAdmin } from "../middleware/requireAdmin";

const router = Router();

/*
 * Manual charge, for operator use only.
 *
 * Since Phase 5 the saga charges by itself when inventory reserves the stock,
 * so nothing in the normal flow calls this. It stays for retries after an
 * operator has looked at a stuck order - and it is guarded now, because until
 * this change anyone who could reach the port could charge a card by posting
 * an order id.
 *
 * The `/test` route that used to sit here is gone: `GET /health` (Phase 6)
 * answers the same question and is excluded from request logging.
 */
router.post(
  "/create-payment",
  requireAdmin,
  processPaymentAndStoreDetailsController
);

export default router;
