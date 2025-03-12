import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "../constants";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Extend Request type to include `user` with only id and role
interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string };
}

export const requireUser = (
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
      userId: string;
      role: string;
    };

    // Check if the role is 'user'
    if (decoded.role !== "user") {
      res
        .status(STATUS_CODES.FORBIDDEN)
        .json({ error: "User access required" });
      return;
    }

    req.user = {
      id: decoded.userId,
      role: decoded.role,
    };
    next();
  } catch (err) {
    console.error("Token verification error:", err);
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Validation error",
      errors: "Invalid or expired token",
    });
    return;
  }
};
