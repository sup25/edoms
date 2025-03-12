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

export const createOrderService = async ({
  userId,
  items,
}: ICreateOrderParams) => {
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
  const order = await Order.create({
    userId,
    items: orderItems,
    status: "pending",
  });

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
