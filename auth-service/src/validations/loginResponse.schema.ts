import { z } from "zod";

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1, "Access token is required"),
  refreshToken: z.string().min(1, "Refresh token is required"),
  expiresAt: z.date().nullable(),
  isAdmin: z.boolean(),
});
