import { Request, Response, NextFunction } from "express";

import { STATUS_CODES } from "../constants";
import { verifyToken } from "../utils/verifyToken";

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const token = req.headers.authorization?.split(" ")[1];

  console.log(token);

  if (!token) {
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "No token provided",
      data: null,
    });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(STATUS_CODES.UNAUTHORIZED).json({
      success: false,
      message: "Invalid or expired token",
      data: null,
    });
  }
};
