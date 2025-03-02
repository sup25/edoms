import bcrypt from "bcrypt";
import { TAuthSchema } from "../validations";
import { generateToken } from "../utils/jwtUtils";
import User from "../model";

export const userRegister = async ({
  email,
  password,
}: TAuthSchema): Promise<string> => {
  // Check if email already exists
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new Error("Email already registered");
  }

  // Hash password
  const password_hash = await bcrypt.hash(password, 10);

  // Create user
  const user = await User.create({ email, password_hash, role: "user" });

  // Generate JWT
  const token = generateToken(user.id.toString(), user.email, user.role);

  return token;
};
