import { Request, Response } from "express";
import { userRegister } from "../service";
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
