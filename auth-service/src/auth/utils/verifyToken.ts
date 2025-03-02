import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./jwtUtils";

export const verifyToken = (token: string): any => {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }

  try {
    return jwt.verify(token, JWT_SECRET as string);
  } catch (error) {
    throw new Error("Invalid or expired token");
  }
};
