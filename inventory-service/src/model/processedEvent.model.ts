import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

/**
 * Consumer-side idempotency ledger.
 *
 * Every consumed event is recorded here by its broker `messageId` inside the
 * same transaction as the work it triggers. A redelivery hits the primary-key
 * constraint, so the handler can skip it instead of applying the same stock
 * change twice.
 *
 * This became necessary with Phase 1: before, a failed handler silently
 * dropped its message, so duplicates were rare. Now messages retry, which
 * makes at-least-once delivery a real path rather than a theoretical one.
 */
class ProcessedEvent extends Model {
  eventId!: string;
  eventType!: string;
  consumer!: string;
  processedAt!: Date;
}

ProcessedEvent.init(
  {
    eventId: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    eventType: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    // Which handler consumed it. The same event legitimately reaches several
    // consumers, so the stored key is `${consumer}:${eventId}`.
    consumer: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "ProcessedEvent",
    tableName: "processed_events",
    underscored: true,
    timestamps: false,
  }
);

export default ProcessedEvent;
