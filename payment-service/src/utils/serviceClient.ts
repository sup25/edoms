import axios from "axios";

/**
 * axios instance for calling peer services.
 *
 * order-service and inventory-service both guard their reads now, so internal
 * calls have to present the shared token. Centralised so a new call site
 * cannot forget it.
 */
export const serviceClient = axios.create({
  timeout: Number(process.env.SERVICE_HTTP_TIMEOUT_MS || 5_000),
});

serviceClient.interceptors.request.use((config) => {
  const token = process.env.SERVICE_TOKEN;
  if (token) config.headers.set("x-service-token", token);
  return config;
});
