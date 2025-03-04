import { Request, Response } from "express";
import { userLogin, userRegister } from "../service";
import expressAsyncHandler from "express-async-handler";
import { STATUS_CODES } from "../constants";

export const registerUserController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
      const token = await userRegister({ email, password });

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

export const userLoginController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    try {
      const { accessToken, refreshToken, expiresAt } = await userLogin({
        email,
        password,
      });

      res.status(STATUS_CODES.OK).json({
        success: true,
        message: "User logged in successfully",
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
