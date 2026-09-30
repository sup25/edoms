import rateLimit from "express-rate-limit";

/**
 * Rate limits.
 *
 * The README has claimed "API rate limiting" since before any existed. These
 * are deliberately generous: the point is to blunt scripted abuse - credential
 * stuffing, enumerating ids - not to police normal traffic.
 *
 * Counted per IP. Behind a proxy that means the proxy unless `trust proxy` is
 * set, which is a Phase 7 concern once these run in containers behind
 * something.
 */
export const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  limit: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // The probes are polled every few seconds by an orchestrator and must never
  // be throttled - a 429 there reads as the service being unhealthy.
  skip: (req) => ["/health", "/ready", "/metrics"].includes(req.path),
  message: {
    success: false,
    message: "Too many requests, please try again shortly",
    data: null,
  },
});

/**
 * Tighter limit for credential endpoints.
 *
 * Login and registration are where guessing pays off, so they get their own
 * budget rather than sharing the general one.
 */
export const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60_000),
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Count only failures, so a busy legitimate user is not locked out by their
  // own successful logins.
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many attempts, please try again later",
    data: null,
  },
});
