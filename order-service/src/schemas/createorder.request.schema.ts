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

// Define the schema for the entire request body
const CreateOrderRequestSchema = z.object({
  userId: z.number().int().positive({
    message: "User ID must be a positive integer",
  }),
  items: z.array(OrderItemSchema).nonempty({
    message: "Items must be a non-empty array",
  }),
});

export { CreateOrderRequestSchema };
