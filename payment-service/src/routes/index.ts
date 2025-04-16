// routes/payment.route.ts
import { Router } from "express";
import { processPaymentAndStoreDetailsController } from "../controller";

const router = Router();

// POST route for creating a payment intent
router.post("/create-payment", processPaymentAndStoreDetailsController);
router.get("/test", (req, res) => {
  res.json({ message: "Server is running!" });
});
export default router;
