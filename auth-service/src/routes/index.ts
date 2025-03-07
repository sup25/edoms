import express, { Request, Response } from "express";
import {
  adminRegisterServiceController,
  LoginController,
  RefreshAccessTokenController,
  userRegisterServiceController,
} from "../controller";
import { authMiddleware } from "../middleware/authMiddleware";
import { validate } from "../middleware/validateRequest";
import { authSchema } from "../validations";

const router = express.Router();
router.post(
  "/admin/register",
  validate(authSchema),
  adminRegisterServiceController
);
router.post(
  "/user/register",
  validate(authSchema),
  userRegisterServiceController
);
router.post("/login", validate(authSchema), LoginController);

router.get("/protected", authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "You have access to this protected route!",
    data: req.user,
  });
});

router.post("/refresh", RefreshAccessTokenController);

export default router;
