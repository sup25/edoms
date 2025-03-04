import { Request, Response, NextFunction } from "express";
import { STATUS_CODES } from "../constants";
import { verifyToken } from "../utils/verifyToken";
import { generateToken } from "../utils/generateToken";

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
    if (
      error instanceof Error &&
      error.message === "Invalid or expired token"
    ) {
      const refreshToken = req.headers["x-refresh-token"] as string;

      if (!refreshToken) {
        res.status(STATUS_CODES.UNAUTHORIZED).json({
          success: false,
          message: "Refresh token required",
          data: null,
        });
        return;
      }

      try {
        // Verify refresh token
        const decodedRefresh = verifyToken(refreshToken);

        // Generate new access token
        const newAccessToken = generateToken(
          decodedRefresh.userId,
          decodedRefresh.email,
          decodedRefresh.role,
          "2m"
        );

        // Send new access token in response header
        res.setHeader("x-new-access-token", newAccessToken);

        // Attach decoded user info to request
        req.user = decodedRefresh;
        next(); // Proceed with the request
      } catch (refreshError: unknown) {
        // Handle refresh token verification error
        if (refreshError instanceof Error) {
          res.status(STATUS_CODES.UNAUTHORIZED).json({
            success: false,
            message: "Invalid or expired refresh token",
            data: null,
          });
        } else {
          res.status(STATUS_CODES.UNAUTHORIZED).json({
            success: false,
            message: "Unknown refresh token error",
            data: null,
          });
        }
      }
    } else {
      // Other errors (e.g., malformed token)
      res.status(STATUS_CODES.UNAUTHORIZED).json({
        success: false,
        message: "Invalid token",
        data: null,
      });
    }
  }
};
