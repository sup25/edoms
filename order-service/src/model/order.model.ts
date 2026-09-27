import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

/**
 * Order saga states.
 *
 *   pending  --inventory.order.reserved-->  reserved
 *   reserved --payment.succeeded---------->  paid
 *   paid     --reservation.confirmed------>  confirmed
 *
 *   pending  --reservation.failed--------->  failed
 *   reserved --payment.failed------------->  failed
 *   pending|reserved --saga timeout------->  cancelled
 *
 * Before Phase 5 there were only pending/confirmed/failed, because the client
 * drove the middle of the saga by hand and the system had no idea an order was
 * waiting on payment. The intermediate states are what make a timeout possible.
 */
export const ORDER_STATUS = [
  "pending",
  "reserved",
  "paid",
  "confirmed",
  "failed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUS)[number];

/** States a saga can still move on from; anything else is terminal. */
export const IN_FLIGHT_STATUSES: OrderStatus[] = ["pending", "reserved", "paid"];

class Order extends Model {
  id!: number;
  userId!: number;
  status!: OrderStatus;
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
      type: DataTypes.ENUM(...ORDER_STATUS),
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
