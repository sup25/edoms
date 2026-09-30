import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { STATUS_CODES } from "../constants";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

/**
 * Admin-only guard for payment-service.
 *
 * `POST /create-payment` had no guard of any kind, so anyone who could reach
 * the port could charge a card by posting an order id. The Stripe idempotency
 * key (`payment-<orderId>`) prevents a SECOND charge for an order; it does
 * nothing about an unauthorised first one.
 *
 * Admin rather than customer is deliberate. Since Phase 5 the saga charges on
 * its own when stock is reserved, so this endpoint exists only for manual
 * retries and operator use. Letting a customer call it would mean verifying
 * they own the order, which needs a blocking HTTP call back to order-service -
 * exactly the coupling Phase 5 removed from the write path.
 */
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Token required",
      data: null,
    });
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as {
      userId: string;
      role: string;
    };

    if (decoded.role !== "admin") {
      res.status(STATUS_CODES.FORBIDDEN).json({
        success: false,
        message: "Admin access required",
        data: null,
      });
      return;
    }

    req.user = { id: decoded.userId, role: decoded.role };
    next();
  } catch {
    // The reason is not echoed back: "expired" vs "bad signature" tells a
    // caller which part of the token to work on.
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Invalid or expired token",
      data: null,
    });
  }
};
