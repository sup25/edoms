import type { Transaction } from "sequelize";
import Order from "../model/order.model";

interface IOrderItem {
  productId: number;
  quantity: number;
  name: string;
  price: string;
}

interface ICreateOrderParams {
  userId: number;
  items: IOrderItem[];
}

export const createOrderService = async (
  { userId, items }: ICreateOrderParams,
  transaction?: Transaction
) => {
  const orderItems = [];
  let totalAmount = 0;

  for (const item of items) {
    const itemTotal = parseFloat(item.price) * item.quantity;
    totalAmount += itemTotal;

    orderItems.push({
      productId: item.productId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      total: itemTotal,
    });
  }

  // Create order in the database
  const order = await Order.create(
    { userId, items: orderItems, status: "pending" },
    { transaction }
  );

  return {
    success: true,
    order: {
      id: order.id,
      userId: order.userId,
      items: order.items,
      status: order.status,
      createdAt: order.createdAt,
      totalAmount: totalAmount.toFixed(2),
    },
  };
};

/**
 * Who is asking. Established by the route guard, never from the request body.
 *
 * `isPrivileged` covers an admin and a peer service: both may read any order,
 * for different reasons (support, and internal retries). A customer may read
 * only their own.
 */
export interface Viewer {
  userId: number;
  isPrivileged: boolean;
}

/**
 * Loads an order the viewer is allowed to see.
 *
 * Both of these endpoints used to take an id and return whatever it pointed
 * at, with no token and no ownership check, so every order in the system was
 * readable by counting upwards. Phase 5 made `/orderStatus/:id` the way a
 * client learns its own outcome, which turned that from obscure into the main
 * read path.
 *
 * Someone else's order reports "Order not found", the same as one that does
 * not exist. Answering 403 would confirm the id is real, which is half of what
 * an enumeration attack is looking for.
 */
async function findOrderFor(orderId: number, viewer: Viewer) {
  const order = await Order.findByPk(orderId);
  if (!order) {
    throw new Error("Order not found");
  }
  if (!viewer.isPrivileged && order.userId !== viewer.userId) {
    throw new Error("Order not found");
  }
  return order;
}

export const getOrderDetailsByIdService = async (
  orderId: number,
  viewer: Viewer
) => {
  const order = await findOrderFor(orderId, viewer);
  return {
    items: order.items,
    status: order.status,
  };
};

export const getOrderStatusByIdService = async (
  orderId: number,
  viewer: Viewer
) => {
  const order = await findOrderFor(orderId, viewer);
  return order.status;
};
