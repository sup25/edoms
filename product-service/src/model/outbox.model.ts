import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

/**
 * Transactional outbox.
 *
 * A row is written in the SAME transaction as the domain change that produced
 * it, so "the order exists" and "the event will be published" commit together
 * or not at all. A relay worker publishes unsent rows afterwards.
 *
 * Without this, a crash between COMMIT and publish left an order that nothing
 * ever reacted to: stuck pending, no stock reserved, no error anywhere
 * (defect #10). Phase 1 made delivery reliable once a message reached the
 * broker; this makes sure it reaches it at all.
 *
 * Delivery becomes at-least-once, so duplicates are expected rather than
 * exceptional - handled by the Phase 3 `processed_events` ledger on the
 * consuming side.
 */
class OutboxEvent extends Model {
  id!: number;
  eventId!: string;
  eventType!: string;
  payload!: unknown;
  correlationId!: string;
  causationId!: string | null;
  status!: "pending" | "sent" | "failed";
  attempts!: number;
  lastError!: string | null;
  availableAt!: Date;
  sentAt!: Date | null;
  createdAt!: Date;
}

OutboxEvent.init(
  {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // Minted at write time, not publish time, so a retry reuses the same id
    // and consumers deduplicate on it.
    eventId: { type: DataTypes.UUID, allowNull: false, unique: true },
    eventType: { type: DataTypes.STRING(128), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    correlationId: { type: DataTypes.STRING(64), allowNull: false },
    causationId: { type: DataTypes.STRING(64), allowNull: true },
    status: {
      type: DataTypes.ENUM("pending", "sent", "failed"),
      allowNull: false,
      defaultValue: "pending",
    },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.TEXT, allowNull: true },
    // Backoff: the relay ignores a row until this time passes.
    availableAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "OutboxEvent",
    tableName: "outbox_events",
    underscored: true,
    timestamps: false,
    indexes: [
      // The relay's hot query: pending rows that are due, oldest first.
      { name: "outbox_pending_idx", fields: ["status", "available_at"] },
    ],
  }
);

export default OutboxEvent;
