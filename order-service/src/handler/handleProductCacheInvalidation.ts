import { EventType } from "@edoms/shared-events";
import { subscribeEvent } from "../rabbitmq/subscriber";
import redis from "../utils/redis";
import logger from "../utils/logger";

interface ProductChangedEvent {
  id: number;
}

/**
 * Invalidates order-service's cached copy of a product.
 *
 * `createOrderController` caches `product:<id>` for ten minutes and, before
 * Phase 2, never invalidated it. A price or name change in product-service was
 * therefore invisible here for up to ten minutes, and orders could be created
 * against a stale price.
 *
 * `product.updated` was published to an exchange nothing was bound to, so the
 * signal existed but went nowhere (defect #2). This is its consumer.
 */
export async function invalidateProductCache(
  event: ProductChangedEvent,
  reason: string
): Promise<void> {
  const { id } = event;
  if (!id) {
    logger.error(`${reason} event without an id`, event);
    return;
  }

  const removed = await redis.del(`product:${id}`);
  logger.info(
    removed > 0
      ? `Invalidated cached product ${id} (${reason})`
      : `No cached product ${id} to invalidate (${reason})`
  );
}

export async function startProductCacheInvalidationService() {
  await subscribeEvent<ProductChangedEvent>(
    EventType.PRODUCT_UPDATED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.PRODUCT_UPDATED}`, {
        correlationId: meta.correlationId,
      });
      await invalidateProductCache(payload, "product.updated");
    },
    { queue: "order-service.product-updated" }
  );

  await subscribeEvent<ProductChangedEvent>(
    EventType.PRODUCT_DELETED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.PRODUCT_DELETED}`, {
        correlationId: meta.correlationId,
      });
      await invalidateProductCache(payload, "product.deleted");
    },
    { queue: "order-service.product-deleted" }
  );

  logger.info("Product cache invalidation service started");
}
