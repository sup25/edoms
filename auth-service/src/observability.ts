import type { DependencyCheck } from "@edoms/shared-observability";
import sequelize from "./config/db";

/**
 * What auth-service needs before it can serve traffic.
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
];
