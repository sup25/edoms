import express, { Request, Response } from "express";
import {
  adminRegisterController,
  LoginController,
  userRegisterController,
} from "../controller";
import { authMiddleware } from "../middleware/authMiddleware";
import { validate } from "../middleware/validateRequest";
import { authSchema } from "../validations";

const router = express.Router();
router.post("/admin/register", validate(authSchema), adminRegisterController);
router.post("/user/register", validate(authSchema), userRegisterController);
router.post("/login", validate(authSchema), LoginController);

router.get("/protected", authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "You have access to this protected route!",
    data: req.user,
  });
});

export default router;
