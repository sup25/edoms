import { migrator } from "./config/migrator";

/**
 * CLI entry point: `npm run migrate`, `npm run migrate:down`, `npm run migrate:status`.
 *
 * Boot-time migration keeps `npm run dev` a single command, but several
 * replicas racing to migrate is not something to leave to chance. In
 * production set MIGRATE_ON_BOOT=false and run this as a deploy step.
 */
migrator.runAsCLI();
