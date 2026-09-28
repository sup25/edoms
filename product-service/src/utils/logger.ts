import { createLogger } from "@edoms/shared-observability";

/**
 * The product-service logger.
 *
 * The configuration lives in @edoms/shared-observability so all five
 * services emit the same shape, and so the ambient correlationId is
 * attached to every line without any call site asking for it.
 */
const logger = createLogger({ service: "product-service" });

export default logger;
