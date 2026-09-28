import type { Migration } from "../config/migrator";

/**
 * Baseline schema for auth-service.
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
  CREATE TYPE enum_users_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;`);

  await sequelize.query(`CREATE TABLE IF NOT EXISTS users (
  id SERIAL NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role enum_users_role NOT NULL DEFAULT 'user'::enum_users_role,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id)
);`);

  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_uniq ON users (email);`);
};

/*
 * Deliberately not reversible. Dropping every table in the service is not
 * something a migration tool should offer to do by accident; recreate the
 * database instead.
 */
export const down: Migration = async () => {
  throw new Error("The baseline migration cannot be reverted. Drop the database instead.");
};
