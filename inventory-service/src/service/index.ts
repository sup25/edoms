import { Transaction } from "sequelize";
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

/**
 * Sets a product's stock to an absolute value.
 *
 * Takes the caller's transaction rather than opening its own, so the write and
 * the `inventory.stock.updated` outbox row commit together. It used to run in
 * a transaction of its own and the controller published in a second one, which
 * reopened the dual-write gap the outbox exists to close: a crash between the
 * two committed the new stock and lost the event, leaving product-service's
 * cache stale with nothing to correct it.
 */
export const updateProductStockService = async (
  { id, stock }: TupdateProductStocks,
  transaction: Transaction
): Promise<Stock> => {
  // SELECT FOR UPDATE: hold the row so a concurrent update cannot read the
  // same starting value. Unlike the order path this is an absolute set, not a
  // decrement, so there is no condition to fold into the write.
  let existingStock = await Stock.findByPk(id, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!existingStock) {
    // If stock entry doesn't exist, create it
    existingStock = await Stock.create(
      { productId: id, stock },
      { transaction }
    );
  } else {
    if (stock < 0) {
      throw new Error("Stock cannot be negative");
    }
    existingStock.stock = stock;
    await existingStock.save({ transaction });
  }

  return existingStock;
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
