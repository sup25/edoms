import express, { Request, Response } from "express";
import {
  adminRegisterController,
  LoginController,
  RefreshAccessTokenController,
  userRegisterController,
} from "../controller";
import { authMiddleware } from "../middleware/authMiddleware";
import { validate } from "../middleware/validateRequest";
import { authSchema } from "../validations/auth.schema";

import { authLimiter } from "../middleware/security";

const router = express.Router();
/*
 * Credential endpoints get their own, much tighter budget. These are where
 * guessing pays off, so they should not share the general API allowance.
 * `authLimiter` counts failures only, so a legitimate user's own successful
 * logins never lock them out.
 */
router.post("/admins", authLimiter, validate(authSchema), adminRegisterController);
router.post("/users", authLimiter, validate(authSchema), userRegisterController);
router.post("/auth/login", authLimiter, validate(authSchema), LoginController);
router.post("/auth/refresh", authLimiter, RefreshAccessTokenController);
router.get("/protected", authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "You have access to this protected route!",
    data: req.user,
  });
});

export default router;
