import connectdb from "../config/db";
import Stock from "../model/stock.model";
import OrderReservation from "../model/orderReservation.model";
import { TOrderReservationResponse, TupdateProductStocks } from "../types";

export const getProductStockById = async (
  productId: number
): Promise<number> => {
  const stock = await Stock.findByPk(productId);
  if (!stock) {
    throw new Error(`Stock not found for productId: ${productId}`);
  }
  return stock.stock;
};

export const getStockWithProductIdService = async (): Promise<
  { productId: number; stock: number }[]
> => {
  const stockRecords = await Stock.findAll({
    attributes: ["productId", "stock"],
  });

  return stockRecords.map((record) => ({
    productId: record.productId,
    stock: record.stock,
  }));
};

export const updateProductStockService = async ({
  id,
  stock,
}: TupdateProductStocks): Promise<Stock> => {
  return await connectdb.transaction(async (t) => {
    // Lock the row using SELECT FOR UPDATE
    let existingStock = await Stock.findByPk(id, {
      transaction: t,
      lock: t.LOCK.UPDATE, // Lock the row to prevent race conditions
    });

    if (!existingStock) {
      // If stock entry doesn't exist, create it
      existingStock = await Stock.create(
        { productId: id, stock },
        { transaction: t }
      );
    } else {
      if (stock < 0) {
        throw new Error("Stock cannot be negative");
      }
      existingStock.stock = stock;
      await existingStock.save({ transaction: t });
    }

    return existingStock;
  });
};

export const getOrderReservationsService = async (): Promise<
  TOrderReservationResponse[]
> => {
  const reservations = await OrderReservation.findAll();
  return reservations.map((r) => r.toJSON());
};

export const getOrderReservationsByIdService = async (orderId: number) => {
  const reservations = await OrderReservation.findAll({
    where: { orderId },
  });

  return reservations.map((r) => r.toJSON());
};
