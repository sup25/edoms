import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";
import connectdb from "../config/db";

interface StockAttributes extends InferAttributes<Stock> {}
interface StockCreationAttributes extends InferCreationAttributes<Stock> {}

class Stock
  extends Model<StockAttributes, StockCreationAttributes>
  implements StockAttributes
{
  public productId!: number;
  public stock!: number;
  public low_stock_threshold?: number;
}

Stock.init(
  {
    productId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      allowNull: false,
      unique: true,
    },
    stock: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    low_stock_threshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5, // Default threshold
    },
  },
  {
    sequelize: connectdb,
    tableName: "Stocks",
    timestamps: false,
  }
);

export default Stock;
