import { Request, Response, NextFunction } from "express";
import { ZodError, ZodSchema } from "zod";
import { STATUS_CODES } from "../constants";

export const validate =
  (bodySchema?: ZodSchema, paramsSchema?: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = bodySchema?.parse(req.body);
      if (paramsSchema) {
        req.params = paramsSchema.parse(req.params);
      }
      if (!bodySchema && !paramsSchema) {
        throw new Error("At least one schema must be provided");
      }
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
