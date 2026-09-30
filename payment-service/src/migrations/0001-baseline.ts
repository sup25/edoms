import type { Migration } from "../config/migrator";

/**
 * Baseline schema for payment-service.
 *
 * Written from the schema `sync({ alter: true })` had produced, so an
 * existing database is left exactly as it is and a fresh one comes out
 * identical. Everything is IF NOT EXISTS for that reason: this migration has
 * to be a no-op against a database that already has these tables.
 *
 * Indexes are named explicitly. Sequelize generated names like
 * `Products_slug_key382`, incrementing on every boot because it could not
 * recognise the index it had created the time before - see 002.
 */
export const up: Migration = async ({ context: sequelize }) => {
  await sequelize.query(`DO $$ BEGIN
  CREATE TYPE enum_outbox_events_status AS ENUM ('pending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`);

  await sequelize.query(`DO $$ BEGIN
  CREATE TYPE enum_payments_status AS ENUM ('success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`);

  await sequelize.query(`CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL NOT NULL,
  event_id UUID NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL,
  correlation_id VARCHAR(64) NOT NULL,
  causation_id VARCHAR(64),
  status enum_outbox_events_status NOT NULL DEFAULT 'pending'::enum_outbox_events_status,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id)
);`);

  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS outbox_events_event_id_uniq ON outbox_events (event_id);`);

  await sequelize.query(`CREATE INDEX IF NOT EXISTS outbox_events_status_available_at_idx ON outbox_events (status, available_at);`);

  await sequelize.query(`CREATE TABLE IF NOT EXISTS payments (
  id SERIAL NOT NULL,
  order_id VARCHAR(50) NOT NULL,
  status enum_payments_status NOT NULL,
  amount INTEGER NOT NULL,
  payment_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id)
);`);

  await sequelize.query(`CREATE TABLE IF NOT EXISTS processed_webhooks (
  event_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (event_id)
);`);
};

/*
 * Deliberately not reversible. Dropping every table in the service is not
 * something a migration tool should offer to do by accident; recreate the
 * database instead.
 */
export const down: Migration = async () => {
  throw new Error("The baseline migration cannot be reverted. Drop the database instead.");
};
