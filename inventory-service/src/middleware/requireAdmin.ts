import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "../constants";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Extend Request type to include `user`
interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(STATUS_CODES.UNAUTHORIZED).json({ error: "Token required" });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: string;
      role: string;
    };

    if (decoded.role !== "admin") {
      res
        .status(STATUS_CODES.FORBIDDEN)
        .json({ error: "Admin access required" });
      return;
    }

    req.user = decoded;
    next();
  } catch (err) {
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Validation error",
      errors: "Invalid or expired token",
    });
    return;
  }
};
