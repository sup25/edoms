export enum ERole {
  Admin = "admin",
  User = "user",
}

import { z } from "zod";

export const tokenPayloadSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  email: z.string().email("Invalid email format"),
  role: z.enum([ERole.Admin, ERole.User]),
});
