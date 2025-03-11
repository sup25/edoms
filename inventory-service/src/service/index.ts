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
  let existingStock = await Stock.findByPk(id);

  if (!existingStock) {
    existingStock = await Stock.create({ productId: id, stock });
  } else {
    if (stock < 0) {
      throw new Error("Stock cannot be negative");
    }
    existingStock.stock = stock;
    await existingStock.save();
  }

  return existingStock;
};
