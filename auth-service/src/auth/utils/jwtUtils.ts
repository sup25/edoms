import jwt from "jsonwebtoken";
import * as dotenv from "dotenv";

dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not defined in environment variables");
}

export const generateToken = (
  userId: string,
  email: string,
  role: string,
  expiresIn: jwt.SignOptions["expiresIn"] = "2m"
): string => {
  const payload = { userId, email, role };

  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};
