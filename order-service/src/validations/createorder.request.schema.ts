import { z } from "zod";

// Define the schema for a single order item
const OrderItemSchema = z.object({
  productId: z.number().int().positive({
    message: "Product ID must be a positive integer",
  }),
  quantity: z.number().int().positive({
    message: "Quantity must be a positive integer",
  }),
});

/*
 * Define the schema for the entire request body.
 *
 * No `userId`. It used to be required here and read straight out of the body
 * by the controller, which let any authenticated customer place an order as
 * someone else. The owner comes from the verified token now, so accepting the
 * field at all would only invite confusion about which one wins.
 */
const CreateOrderRequestSchema = z.object({
  items: z.array(OrderItemSchema).nonempty({
    message: "Items must be a non-empty array",
  }),
});

const getOrderDetailsRequest = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a valid integer").transform(Number),
});

const getOrderStatusRequestSchema = z.object({
  id: z.string().regex(/^\d+$/, "ID must be a valid integer").transform(Number),
});

export {
  CreateOrderRequestSchema,
  getOrderStatusRequestSchema,
  getOrderDetailsRequest,
};
