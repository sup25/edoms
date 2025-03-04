import { z } from "zod";

const authSchema = z.object({
  email: z
    .string()
    .email("Invalid email format")
    .min(1, "Email is required")
    .max(255, "Email must be 255 characters or less"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(255, "Password must be 255 characters or less"),
});

export type TAuthSchema = z.infer<typeof authSchema>;
module.exports = { authSchema };
