import { z } from "zod";
import { authSchema } from "../validations";

export enum ERole {
  Admin = "admin",
  User = "user",
}

export type TLoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  isAdmin: boolean;
};

export type TAuthSchema = z.infer<typeof authSchema>;
