import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

class Order extends Model {
  id!: number;
  userId!: number;
  status!: string;
  items!: any;
  createdAt!: Date;
  updatedAt!: Date;
}

Order.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    items: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "confirmed", "failed"),
      defaultValue: "pending",
    },
  },
  {
    sequelize,
    modelName: "Order",
    tableName: "orders",
    underscored: true,
    timestamps: true,
  }
);

export default Order;
