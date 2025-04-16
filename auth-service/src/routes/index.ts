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

const router = express.Router();
router.post("/admins", validate(authSchema), adminRegisterController);
router.post("/users", validate(authSchema), userRegisterController);
router.post("/auth/login", validate(authSchema), LoginController);
router.post("/auth/refresh", RefreshAccessTokenController);
router.get("/protected", authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "You have access to this protected route!",
    data: req.user,
  });
});

export default router;
