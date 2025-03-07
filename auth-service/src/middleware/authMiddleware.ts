import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "../constants";
import { verifyToken } from "../utils/verifyToken";

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Extract access token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "No token provided",
      data: null,
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify access token
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error: unknown) {
    // Handle all token verification errors
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Invalid or expired token",
      data: null,
    });
  }
};
