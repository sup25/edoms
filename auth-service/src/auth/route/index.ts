import express, { Request, Response } from "express";
import { loginUserController, registerUserController } from "../controller";
import { authMiddleware } from "../middleware";

const router = express.Router();

router.post("/register", registerUserController);
router.post("/login", loginUserController);

router.get("/protected", authMiddleware, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "You have access to this protected route!",
    data: req.user,
  });
});

export default router;
