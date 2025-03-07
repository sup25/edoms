import { Request, Response } from "express";
import {
  adminRegisterService,
  loginService,
  refreshAccessTokenService,
  userRegisterService,
} from "../service";
import expressAsyncHandler from "express-async-handler";
import { STATUS_CODES } from "../constants";
import { ERole } from "../types";

export const adminRegisterServiceController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;
    try {
      const token = await adminRegisterService({ email, password });
      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "Admin registered successfully",
        data: token,
      });
    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        if (error.message === "Email already registered") {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: error.message,
            data: null,
          });
          return;
        }
      }

      res.status(500).json({ message: "Server error" });
    }
  }
);

export const userRegisterServiceController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
      const token = await userRegisterService({ email, password });

      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "User registered successfully",
        data: token,
      });
    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        if (error.message === "Email already registered") {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: error.message,
            data: null,
          });
          return;
        }
      }

      res.status(500).json({ message: "Server error" });
    }
  }
);

export const LoginController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
      const { accessToken, refreshToken, expiresAt, isAdmin } =
        await loginService({
          email,
          password,
        });

      const messageMap: { [key in ERole]: string } = {
        admin: "Admin logged in successfully",
        user: "User logged in successfully",
      };
      const userRole = isAdmin ? ERole.Admin : ERole.User;
      const loginMessage = messageMap[userRole];

      res.status(STATUS_CODES.OK).json({
        success: true,
        message: loginMessage,
        data: {
          accessToken,
          refreshToken,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
        },
      });
    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        if (error.message === "Invalid credentials") {
          res.status(STATUS_CODES.UNAUTHORIZED).json({
            success: false,
            message: error.message,
            data: null,
          });
          return;
        }
      }

      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Server error",
        data: null,
      });
    }
  }
);

export const RefreshAccessTokenController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const refreshToken = req.headers["x-refresh-token"] as string;
    console.log("controller Refresh Token:", refreshToken);
    if (!refreshToken) {
      res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Refresh token not provided",
        data: null,
      });
      return;
    }

    try {
      const accessToken = await refreshAccessTokenService(refreshToken);
      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "Access token refreshed successfully",
        data: {
          accessToken,
        },
      });
    } catch (error: unknown) {
      console.error(error);

      if (error instanceof Error) {
        if (
          error.message === "Invalid or expired token" ||
          error.message === "jwt expired"
        ) {
          res.status(STATUS_CODES.UNAUTHORIZED).json({
            success: false,
            message: "Invalid or expired refresh token",
            data: null,
          });
          return;
        }
        if (error.message === "User not found") {
          res.status(STATUS_CODES.NOT_FOUND).json({
            success: false,
            message: "User not found",
            data: null,
          });
          return;
        }
      }

      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Server error",
        data: null,
      });
    }
  }
);
