import Stock from "../model/inventory.model";
import { TupdateProductStocks } from "../types";

export const getProductStockById = async (
  productId: number
): Promise<number> => {
  const stock = await Stock.findByPk(productId);

  if (!stock) {
    throw new Error(`Stock not found for productId: ${productId}`);
  }

  return stock.stock;
};

export const updateProductStockService = async ({
  id,
  stock,
}: TupdateProductStocks): Promise<Stock> => {
  const initailStock = await Stock.findByPk(id);
  if (!initailStock) {
    throw new Error(`Stock not found for productId: ${id}`);
  }
  if (stock < 0) {
    throw new Error("Stock cannot be negative");
  }

  initailStock.stock = stock;
  await initailStock.save();
  return initailStock;
};
