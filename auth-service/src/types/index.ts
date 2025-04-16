import { z } from "zod";
import { authSchema } from "../validations/auth.schema";
import { tokenPayloadSchema } from "../validations/tokenPayload.schema";
import { loginResponseSchema } from "../validations/loginResponse.schema";

export enum ERole {
  Admin = "admin",
  User = "user",
}

export type TLoginResponse = z.infer<typeof loginResponseSchema>;
export type TAuthSchema = z.infer<typeof authSchema>;
export type TTokenPayload = z.infer<typeof tokenPayloadSchema>;
