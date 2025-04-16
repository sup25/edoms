import Payment from "../model/payment.model";
import sequelize from "../config/db";
import logger from "../utils/logger";

export async function handleStorePayment(
  orderId: string,
  amount: number,
  paymentId: string,
  status: string
) {
  const lockId = Math.abs(hashString(orderId));

  return sequelize.transaction(async (t) => {
    logger.info("Transaction started for order:", orderId);
    try {
      // Acquire an advisory lock
      await sequelize.query("SELECT pg_advisory_xact_lock(:lockId)", {
        replacements: { lockId },
        transaction: t,
      });

      const existingPayment = await Payment.findOne({
        where: { orderId },
        transaction: t,
      });

      if (existingPayment) {
        if (
          existingPayment.status === status &&
          existingPayment.paymentId === paymentId &&
          existingPayment.amount === amount
        ) {
          return existingPayment;
        }
        throw new Error("Payment already exists with different details");
      }
      logger.info("Creating New Payment Record...");
      const newPayment = await Payment.create(
        { orderId, amount, paymentId, status },
        { transaction: t }
      );

      logger.info("Payment Stored Successfully:", newPayment.toJSON());
      return newPayment;
    } catch (error) {
      logger.error("Error storing payment:", error);
      throw new Error("Failed to store payment details");
    }
  });
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash; // 32-bit integer
  }
  return hash;
}
