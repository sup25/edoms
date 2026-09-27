import { EventType } from "@edoms/shared-events";
import { subscribeEvent } from "../rabbitmq/subscriber";
import ProductProjection from "../model/productProjection.model";
import redis from "../utils/redis";
import logger from "../utils/logger";

interface ProductEvent {
  id: number;
  name?: string;
  price?: number | string;
  slug?: string;
}

/**
 * Keeps order-service's local copy of the product catalogue current.
 *
 * Replaces the per-item HTTP call the order controller used to make. Because
 * the data is already local when an order arrives, product-service being down
 * no longer stops orders being placed.
 *
 * Also drops the Redis entry, which order-service held for ten minutes without
 * ever invalidating it (defect #2).
 */
export async function upsertProduct(event: ProductEvent): Promise<void> {
  const { id, name, price, slug } = event;
  if (!id) {
    logger.error("product event without an id", event);
    return;
  }

  // An update event may carry only the changed fields, so fall back to what is
  // already stored rather than overwriting with undefined.
  const existing = await ProductProjection.findByPk(id);

  if (!existing && (name === undefined || price === undefined)) {
    logger.warn(
      `Cannot project product ${id}: no local row and the event omits name/price`
    );
    return;
  }

  await ProductProjection.upsert({
    productId: id,
    name: name ?? existing!.name,
    price: String(price ?? existing!.price),
    slug: slug ?? existing?.slug ?? null,
    updatedAt: new Date(),
  });

  await redis.del(`product:${id}`);
  logger.info(`Projected product ${id}`);
}

export async function removeProduct(event: ProductEvent): Promise<void> {
  const { id } = event;
  if (!id) {
    logger.error("product.deleted without an id", event);
    return;
  }

  await ProductProjection.destroy({ where: { productId: id } });
  await redis.del(`product:${id}`);
  logger.info(`Removed product ${id} from the projection`);
}

export async function startProductProjectionService() {
  await subscribeEvent<ProductEvent>(
    EventType.PRODUCT_CREATED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.PRODUCT_CREATED}`, {
        correlationId: meta.correlationId,
      });
      await upsertProduct(payload);
    },
    { queue: "order-service.product-created" }
  );

  await subscribeEvent<ProductEvent>(
    EventType.PRODUCT_UPDATED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.PRODUCT_UPDATED}`, {
        correlationId: meta.correlationId,
      });
      await upsertProduct(payload);
    },
    { queue: "order-service.product-updated" }
  );

  await subscribeEvent<ProductEvent>(
    EventType.PRODUCT_DELETED,
    async (payload, meta) => {
      logger.info(`Received ${EventType.PRODUCT_DELETED}`, {
        correlationId: meta.correlationId,
      });
      await removeProduct(payload);
    },
    { queue: "order-service.product-deleted" }
  );

  logger.info("Product projection service started");
}
