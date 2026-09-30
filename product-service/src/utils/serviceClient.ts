import axios from "axios";

/**
 * axios instance for calling peer services.
 *
 * inventory-service's reads are behind `requireService` now, so every internal
 * call has to present the shared token. Centralised here so a new call site
 * cannot forget it - and so there is one place to swap this for mTLS or a
 * mesh identity when Phase 7 puts these in containers.
 */
export const serviceClient = axios.create({
  timeout: Number(process.env.SERVICE_HTTP_TIMEOUT_MS || 5_000),
});

serviceClient.interceptors.request.use((config) => {
  const token = process.env.SERVICE_TOKEN;
  if (token) config.headers.set("x-service-token", token);
  return config;
});
