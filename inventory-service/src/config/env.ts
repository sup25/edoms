import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Environment for inventory-service, validated once at boot.
 *
 * Before this, config was read with `process.env.X || "some-default"` wherever
 * it happened to be needed. A missing or misspelt variable surfaced much later
 * as a confusing runtime failure - a JWT_SECRET that silently fell back to
 * "your-secret-key" rejects every real token, and `NODE_ENV` set to a pasted
 * shell command quietly disabled every production branch.
 *
 * Failing here instead means a misconfigured service never starts.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5002),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),

  /* Shared with auth-service - a mismatch silently rejects every token. */
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),

  BROKER_URL: z.string().min(1).default("amqp://localhost:5672"),

  /* Shared secret for peer-service calls. Optional so a single
     service can still be run alone in development. */
  SERVICE_TOKEN: z.string().min(16).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  // console, not the logger: the logger reads this config.
  console.error(`Invalid environment for inventory-service -> ${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
