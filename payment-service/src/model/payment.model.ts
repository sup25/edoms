import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

class Payment extends Model {
  id!: number;
  orderId!: string;
  status!: "success" | "failed";
  amount!: number;
  paymentId!: string;
  createdAt!: Date;
}

Payment.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    orderId: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("success", "failed"),
      allowNull: false,
    },
    amount: {
      type: DataTypes.INTEGER, // Store in cents (e.g., 208995 for $2089.95)
      allowNull: false,
    },
    paymentId: {
      type: DataTypes.STRING(255), // Stripe payment intent IDs are longer
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "Payment",
    tableName: "payments",
    underscored: true,
    timestamps: true, // Only need createdAt, but Sequelize adds updatedAt too
    updatedAt: false, // Disable updatedAt since we don’t need it
  }
);

export default Payment;
