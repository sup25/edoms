import path from "path";
import { Umzug, SequelizeStorage } from "umzug";
import sequelize from "./db";
import logger from "../utils/logger";

/**
 * Schema migrations.
 *
 * Replaces `sync({ alter: true })`, which did not just "silently mutate the
 * schema at runtime" - it actively damaged it. Sequelize cannot recognise a
 * unique index it created on a previous boot, so every start added another
 * one. This repo's product table had accumulated 383 unique indexes on
 * `slug`, and the outbox tables 18 to 38 apiece on `event_id`, all identical.
 * Every `npm run dev` added more, and each one slows every insert.
 *
 * Migrations run in order, once, and are recorded in `migrations_meta`.
 */
export const migrator = new Umzug({
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

export type Migration = typeof migrator._types.migration;

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

  const applied = await migrator.up();
  if (applied.length === 0) {
    logger.info("Schema up to date");
    return;
  }
  logger.info(`Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(", ")}`);
}
