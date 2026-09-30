import path from "path";
import { Umzug, SequelizeStorage } from "umzug";
import sequelize from "./db";
import logger from "../utils/logger";

/**
 * Schema migrations.
 *
 * Replaces `sync({ alter: true })`, which did not merely mutate the schema at
 * runtime - it damaged it. Sequelize cannot recognise a unique constraint it
 * created on a previous boot, so every start added another one. This repo had
 * accumulated 386 identical unique constraints on `Products.slug` and 18 to 38
 * on each service's `outbox_events.event_id`: 506 indexes across five
 * databases where about fifteen were wanted, and each one is maintained on
 * every insert.
 *
 * Migrations run in order, once, and are recorded in `migrations_meta`.
 */

function buildMigrator() {
  return new Umzug({
    migrations: {
      // Forward slashes and an absolute path: the glob library does not treat
      // Windows backslashes as separators, so a relative pattern silently
      // matched nothing and every service reported "applied 0 migrations".
      glob: path.join(__dirname, "..", "migrations", "*.{ts,js}").split(path.sep).join("/"),
    },
    context: sequelize,
    storage: new SequelizeStorage({ sequelize, tableName: "migrations_meta" }),
    logger: {
      info: (message) => logger.info(`migration: ${JSON.stringify(message)}`),
      warn: (message) => logger.warn(`migration: ${JSON.stringify(message)}`),
      error: (message) => logger.error(`migration: ${JSON.stringify(message)}`),
      debug: () => undefined,
    },
  });
}

/*
 * Built on demand rather than at import.
 *
 * SequelizeStorage reaches into the Sequelize instance as it is constructed,
 * so building this at module scope made merely IMPORTING the app fail in any
 * test that mocks the database - which is every controller test. Nothing here
 * should do work just because it was required.
 */
let instance: ReturnType<typeof buildMigrator> | undefined;

export function getMigrator(): ReturnType<typeof buildMigrator> {
  if (!instance) instance = buildMigrator();
  return instance;
}

export type Migration = ReturnType<typeof buildMigrator>["_types"]["migration"];

/**
 * Brings the schema up to date.
 *
 * Runs on boot by default, which keeps `npm run dev` a single command. Set
 * `MIGRATE_ON_BOOT=false` in production and run `npm run migrate` as a deploy
 * step instead - several replicas racing to migrate is not something to leave
 * to chance.
 */
export async function runMigrations(): Promise<void> {
  if (process.env.MIGRATE_ON_BOOT === "false") {
    logger.info("MIGRATE_ON_BOOT=false; skipping migrations");
    return;
  }

  const applied = await getMigrator().up();
  if (applied.length === 0) {
    logger.info("Schema up to date");
    return;
  }
  logger.info(`Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(", ")}`);
}
