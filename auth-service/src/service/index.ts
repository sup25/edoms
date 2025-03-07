import bcrypt from "bcrypt";
import { generateToken } from "../utils/generateToken";
import User from "../model";
import { getExpirationFromToken } from "../utils/getExpirationFromToken";
import { ERole, TAuthSchema, TLoginResponse, TTokenPayload } from "../types";
import { verifyToken } from "../utils/verifyToken";

export const adminRegisterService = async ({
  email,
  password,
}: TAuthSchema): Promise<string> => {
  // Check if email already exists
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new Error("Admin already registered");
  }

  // Hash password
  const password_hash = await bcrypt.hash(password, 10);

  // Create user
  const user = await User.create({ email, password_hash, role: ERole.Admin });

  // Generate JWT
  const token = generateToken(user.id.toString(), user.email, user.role);

  return token;
};

export const userRegisterService = async ({
  email,
  password,
}: TAuthSchema): Promise<string> => {
  const existingUser = await User.findOne({ where: { email } });
  if (existingUser) {
    throw new Error("Email already registered");
  }
  const password_hash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, password_hash, role: ERole.User });
  const token = generateToken(user.id.toString(), user.email, user.role);
  return token;
};

export const loginService = async ({
  email,
  password,
}: TAuthSchema): Promise<TLoginResponse> => {
  const user = await User.findOne({ where: { email } });

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new Error("Invalid credentials");
  }
  const isAdmin = user.role === ERole.Admin;
  // Generate JWT
  const accessToken = generateToken(
    user.id.toString(),
    user.email,
    user.role,
    "5m"
  );
  const refreshToken = generateToken(
    user.id.toString(),
    user.email,
    user.role,
    "7d"
  );

  // Get expiration date
  const expiresAt = getExpirationFromToken(accessToken);

  return { accessToken, refreshToken, expiresAt, isAdmin };
};

export const refreshAccessTokenService = async (
  refreshToken: string
): Promise<string> => {
  const decoded = verifyToken(refreshToken) as TTokenPayload;
  console.log("Decoded Token:", decoded); // Debug
  const user = await User.findByPk(decoded.userId);
  if (!user) {
    throw new Error("User not found");
  }
  const accessToken = generateToken(
    user.id.toString(),
    user.email,
    user.role,
    "5m"
  );
  console.log("generated access token:", accessToken);
  return accessToken;
};
