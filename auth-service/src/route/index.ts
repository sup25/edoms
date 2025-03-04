import express, { Request, Response } from "express";
import { userLoginController, registerUserController } from "../controller";
import { authMiddleware } from "../middleware";

const router = express.Router();

router.post("/register", registerUserController);
router.post("/login", userLoginController);

router.get("/protected", authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "You have access to this protected route!",
    data: req.user,
  });
});

export default router;
