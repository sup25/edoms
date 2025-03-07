import { Request, Response } from "express";
import expressAsyncHandler from "express-async-handler";
import { createProductService } from "../service";
import { STATUS_CODES } from "../constants";

export const createProductController = expressAsyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, price, slug } = req.body;
    try {
      const createProduct = await createProductService({ name, price, slug });
      res.status(STATUS_CODES.CREATED).json({
        success: true,
        message: "Product created successfully",
        data: createProduct,
      });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error) {
        if (
          error.message === "Slug already exists. Please use a different slug."
        ) {
          res.status(STATUS_CODES.BAD_REQUEST).json({
            success: false,
            message: error.message,
            data: null,
          });
          return;
        }
      }

      res.status(STATUS_CODES.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Internal server error",
        data: null,
      });
    }
  }
);
