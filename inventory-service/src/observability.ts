import type { DependencyCheck } from "@edoms/shared-observability";
import sequelize from "./config/db";
import { getConnection } from "./rabbitmq/connection";

/**
 * What inventory-service needs before it can serve traffic.
 *
 * Used by `GET /ready`. `GET /health` deliberately checks none of this: an
 * orchestrator restarts a container that fails liveness, and restarting
 * because Postgres is down turns one outage into a crash loop.
 */
export const dependencies: DependencyCheck[] = [
  {
    name: "postgres",
    check: () => sequelize.authenticate(),
  },
  {
    name: "rabbitmq",
    // getConnection resolves the shared connection, reconnecting if needed, so
    // this reports the state the publishers and consumers actually see.
    check: () => getConnection(),
  },
];
