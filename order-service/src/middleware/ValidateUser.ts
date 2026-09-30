import { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types";
import { STATUS_CODES } from "../constants";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;

interface TokenClaims {
  userId: string;
  role: string;
}

/**
 * Verifies the bearer token and attaches the claims to `req.user`.
 *
 * Returns the claims, or null once it has already answered the request.
 */
function authenticate(req: AuthenticatedRequest, res: Response): TokenClaims | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Token required",
      data: null,
    });
    return null;
  }

  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as TokenClaims;
    req.user = { id: decoded.userId, role: decoded.role };
    return decoded;
  } catch {
    // The reason is deliberately not echoed back: "expired" vs "malformed" vs
    // "bad signature" tells an attacker which part of the token to work on.
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Invalid or expired token",
      data: null,
    });
    return null;
  }
}

/**
 * Customer-only endpoints. Placing an order is one: an admin has no order of
 * their own to place.
 */
export const requireUser = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const claims = authenticate(req, res);
  if (!claims) return;

  if (claims.role !== "user") {
    res.status(STATUS_CODES.FORBIDDEN).json({
      success: false,
      message: "User access required",
      data: null,
    });
    return;
  }

  next();
};

/**
 * Any authenticated caller, customer or admin.
 *
 * For reading an order: a customer may see their own, and an admin may see any
 * (support cannot answer "where is my order" otherwise). The ownership rule
 * itself lives in the service layer, because a middleware cannot know who owns
 * a row it has not read.
 */
export const requireAuthenticated = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  /*
   * A peer service counts too. payment-service reads an order over HTTP when
   * an operator retries a charge, and it has no user to borrow a token from.
   * It presents the shared service token instead, and is treated as
   * privileged - it is asking on the system's behalf, not a customer's.
   */
  const presented = req.header("x-service-token");
  if (SERVICE_TOKEN && presented && presented === SERVICE_TOKEN) {
    req.user = { id: "service", role: "service" };
    next();
    return;
  }

  if (!authenticate(req, res)) return;
  next();
};
