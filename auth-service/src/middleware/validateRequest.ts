import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";
import { STATUS_CODES } from "../constants";

export const validate =
  (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      const zodError = error as ZodError;
      res.status(STATUS_CODES.BAD_REQUEST).json({
        success: false,
        message: "Validation error",
        errors: zodError.errors,
      });
    }
  };
