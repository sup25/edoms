import { z } from "zod";
import { EventType } from "../events";
import { EventContractError } from "../envelope";

const positiveInt = z.number().int().positive();

/*
 * Timestamps arrive either as an ISO string or as a Sequelize Date instance,
 * depending on whether the payload came off the wire or straight out of a
 * model. JSON.stringify turns a Date into the same ISO string, so both are
 * valid on the wire - accept either and normalise to the string form.
 */
const isoTimestamp = z.union([
  z.string(),
  z.date().transform((d) => d.toISOString()),
]);

/*
 * Payload schemas, one per event.
 *
 * These are deliberately strict about the fields consumers actually read. The
 * `order.failed` payload used to omit `orderId`, so order-service looked an
 * order up by `undefined` and left it pending forever. A schema would have
 * caught that at the boundary instead of turning it into silent data drift.
 */

export const productCreatedSchema = z.object({
  id: positiveInt,
  name: z.string().min(1),
  price: z.union([z.number(), z.string()]),
  slug: z.string().min(1),
  // Optional today: product-service has no stock field on create, so inventory
  // initializes at 0. See defect #16.
  stock: z.number().int().nonnegative().optional(),
});

export const productUpdatedSchema = z.object({
  id: positiveInt,
  name: z.string().min(1).optional(),
  price: z.union([z.number(), z.string()]).optional(),
  slug: z.string().min(1).optional(),
});

export const productDeletedSchema = z.object({
  id: positiveInt,
});

export const orderItemSchema = z.object({
  productId: positiveInt,
  quantity: positiveInt,
  name: z.string().optional(),
  price: z.union([z.number(), z.string()]).optional(),
});

export const orderCreatedSchema = z.object({
  orderId: positiveInt,
  userId: positiveInt.optional(),
  items: z.array(orderItemSchema).nonempty(),
  status: z.string().optional(),
  totalAmount: z.union([z.number(), z.string()]).optional(),
  createdAt: isoTimestamp.optional(),
});

export const stockReservedSchema = z.object({
  productId: positiveInt,
  orderId: positiveInt.optional(),
  quantity: z.number().int().positive().optional(),
});

export const stockUpdatedSchema = z.object({
  productId: positiveInt,
  stock: z.number().int().nonnegative(),
});

export const reservationConfirmedSchema = z.object({
  orderId: positiveInt,
  confirmedAt: isoTimestamp.optional(),
});

export const reservationReleasedSchema = z.object({
  // Required. Its absence is exactly the bug described above.
  orderId: positiveInt,
  productId: positiveInt,
  rolledBackQuantity: z.number().int().positive(),
  failedAt: isoTimestamp.optional(),
});

export const reservationFailedSchema = z.object({
  orderId: positiveInt,
  productId: positiveInt.optional(),
  requestedQuantity: z.number().int().optional(),
  reason: z.string().optional(),
  failedAt: isoTimestamp.optional(),
});

// payment-service publishes orderId as a string; accept either and coerce.
const orderIdLoose = z.union([positiveInt, z.string().regex(/^\d+$/)]);

export const paymentSucceededSchema = z.object({
  orderId: orderIdLoose,
  userId: z.union([positiveInt, z.string()]).optional(),
  items: z.array(orderItemSchema).optional(),
});

export const paymentFailedSchema = z.object({
  orderId: orderIdLoose,
  reason: z.string().optional(),
});

export const PAYLOAD_SCHEMA: Record<EventType, z.ZodTypeAny> = {
  [EventType.PRODUCT_CREATED]: productCreatedSchema,
  [EventType.PRODUCT_UPDATED]: productUpdatedSchema,
  [EventType.PRODUCT_DELETED]: productDeletedSchema,
  [EventType.ORDER_CREATED]: orderCreatedSchema,
  [EventType.STOCK_RESERVED]: stockReservedSchema,
  [EventType.STOCK_UPDATED]: stockUpdatedSchema,
  [EventType.RESERVATION_CONFIRMED]: reservationConfirmedSchema,
  [EventType.RESERVATION_RELEASED]: reservationReleasedSchema,
  [EventType.RESERVATION_FAILED]: reservationFailedSchema,
  [EventType.PAYMENT_SUCCEEDED]: paymentSucceededSchema,
  [EventType.PAYMENT_FAILED]: paymentFailedSchema,
};

/**
 * Validates a payload against its event's schema.
 * Throws EventContractError, which the subscriber dead-letters rather than
 * retrying - a payload that is the wrong shape will never become right shape.
 */
export function validatePayload<T = unknown>(
  eventType: EventType,
  payload: unknown
): T {
  const schema = PAYLOAD_SCHEMA[eventType];
  if (!schema) {
    throw new EventContractError(`no schema registered for ${eventType}`);
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new EventContractError(
      `payload does not match the schema for ${eventType}`,
      result.error.flatten()
    );
  }
  return result.data as T;
}
