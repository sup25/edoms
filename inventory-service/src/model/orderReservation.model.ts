import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

class OrderReservation extends Model {
  id!: number;
  orderId!: number;
  productId!: number;
  reservedQuantity!: number;
  status!: "pending" | "confirmed" | "released" | "canceled";
  createdAt!: Date;
  updatedAt!: Date;
}

OrderReservation.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    orderId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    productId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    reservedQuantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "confirmed", "released", "canceled"),
      allowNull: false,
      defaultValue: "pending",
    },
  },
  {
    sequelize,
    modelName: "OrderReservation",
    tableName: "order_reservations",
    underscored: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["order_id", "product_id"],
        name: "order_id_product_id_unique",
      },
    ],
  }
);

export default OrderReservation;
