export const calculateTotalAmount = (
  items: { price: string; quantity: number }[]
) => {
  return items.reduce(
    (total, item) => total + parseFloat(item.price) * item.quantity * 100,
    0
  );
};
