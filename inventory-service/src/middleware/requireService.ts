import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { STATUS_CODES } from "../constants";
import logger from "../utils/logger";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;

/**
 * Allows a peer service OR an admin.
 *
 * inventory-service exposes reads that two different kinds of caller need:
 * product-service fetches stock over HTTP to warm its cache, and an operator
 * needs to inspect reservations. Neither was authenticated at all, so
 * `/reservedstocks` handed every order reservation in the system to anyone who
 * asked.
 *
 * A shared secret is the right weight here. Peer services are inside the same
 * deployment, so the thing being prevented is an outside caller reaching the
 * port - not one service impersonating another. mTLS or a service mesh would
 * address the latter and belongs with the container work in Phase 7.
 *
 * The comparison is length-safe but NOT constant-time. A timing attack against
 * a shared secret over HTTP is not the realistic threat; an unguarded endpoint
 * was.
 */
export const requireService = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const presented = req.header("x-service-token");
  if (SERVICE_TOKEN && presented && presented === SERVICE_TOKEN) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], JWT_SECRET) as {
        role: string;
      };
      if (decoded.role === "admin") {
        next();
        return;
      }
    } catch {
      // Fall through to the single 401 below.
    }
  }

  if (!SERVICE_TOKEN) {
    // Worth saying out loud: without it, peer services cannot authenticate at
    // all and every call here fails, which looks like a bug rather than config.
    logger.error(
      "SERVICE_TOKEN is not set - peer services cannot call inventory-service",
      { alert: "missing_service_token" }
    );
  }

  res.status(STATUS_CODES.UNAUTHORIZED).json({
    success: false,
    message: "Service or admin credentials required",
    data: null,
  });
};
