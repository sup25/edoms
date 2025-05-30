import {
  Model,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";
import connect from "../config/db";
import { ERole } from "../types";

interface UserAttributes extends InferAttributes<User> {}
interface UserCreationAttributes
  extends Omit<InferCreationAttributes<User>, "id" | "created_at"> {}

class User extends Model<UserAttributes, UserCreationAttributes> {
  public id!: number;
  public email!: string;
  public password_hash!: string;
  public role!: ERole;
  public created_at!: Date;
  public updated_at?: Date | null;
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...Object.values(ERole)),
      allowNull: false,
      defaultValue: "user",
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize: connect,
    tableName: "users",
    timestamps: true,
    underscored: true,
  }
);

export default User;
