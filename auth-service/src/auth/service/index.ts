import bcrypt from "bcrypt";
import { TAuthSchema } from "../validations";
import { generateToken } from "../utils/jwtUtils";
import User from "../model";
import { getExpirationFromToken } from "../utils/getExpirationFromToken";

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

export const userLogin = async ({
  email,
  password,
}: TAuthSchema): Promise<{ token: string; expiresAt: Date | null }> => {
  // Find user by email
  const user = await User.findOne({ where: { email } });
  if (!user) {
    throw new Error("Invalid credentials");
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new Error("Invalid credentials");
  }

  // Generate JWT
  const token = generateToken(user.id.toString(), user.email, user.role);

  // Get expiration date
  const expiresAt = getExpirationFromToken(token);

  return { token, expiresAt };
};
