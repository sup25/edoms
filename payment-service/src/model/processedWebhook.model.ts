import { Model, DataTypes } from "sequelize";
import sequelize from "../config/db";

/**
 * Idempotency ledger for Stripe webhooks.
 *
 * Stripe delivers at least once and retries for up to three days, so the same
 * event will arrive more than once whenever our response is slow, lost, or a
 * deploy lands mid-delivery. The same shape as the Phase 3 `processed_events`
 * table, for the same reason: record the id inside the transaction that does
 * the work, and a redelivery hits the primary key instead of doing it twice.
 *
 * A duplicate would otherwise publish a second `payment.succeeded`. Inventory
 * guards on reservation status so it would be a no-op today, but relying on a
 * downstream guard to cover an upstream duplicate is how a later change
 * quietly becomes a double refund.
 */
class ProcessedWebhook extends Model {
  eventId!: string;
  eventType!: string;
  processedAt!: Date;
}

ProcessedWebhook.init(
  {
    eventId: {
      // Stripe's event id, e.g. evt_1ABC...
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
    },
    eventType: {
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
    modelName: "ProcessedWebhook",
    tableName: "processed_webhooks",
    underscored: true,
    timestamps: false,
  }
);

export default ProcessedWebhook;
