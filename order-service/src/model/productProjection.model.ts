import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

/**
 * Local read model of the product catalogue.
 *
 * order-service used to fetch every product over HTTP before it could accept
 * an order - one call per item, inside a loop - which meant no order could be
 * placed while product-service was down. That is precisely the temporal
 * coupling events are supposed to remove.
 *
 * This table is maintained from product.created / product.updated /
 * product.deleted, so the data is already here when an order arrives. It is a
 * projection, not a source of truth: product-service still owns products, and
 * this copy is eventually consistent with it.
 */
class ProductProjection extends Model {
  productId!: number;
  name!: string;
  price!: string;
  slug!: string | null;
  updatedAt!: Date;
}

ProductProjection.init(
  {
    productId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING(255), allowNull: false },
    // DECIMAL as string, matching how product-service stores and reports it.
    price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    slug: { type: DataTypes.STRING(255), allowNull: true },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "ProductProjection",
    tableName: "product_projection",
    underscored: true,
    timestamps: false,
  }
);

export default ProductProjection;
