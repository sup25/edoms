import type { ObsHandler, ObsRequest, ObsResponse } from "./express";

export type CheckStatus = "up" | "down";

export interface CheckResult {
  status: CheckStatus;
  durationMs: number;
  error?: string;
}

export interface DependencyCheck {
  name: string;
  /** Resolves if the dependency is reachable; rejects or returns false if not. */
  check: () => Promise<unknown>;
  /**
   * A dependency the service cannot serve without. Non-critical ones are
   * reported but do not fail readiness - Redis here is a cache, so losing it
   * makes the service slower, not wrong.
   */
  critical?: boolean;
  timeoutMs?: number;
}

async function runCheck(dependency: DependencyCheck): Promise<CheckResult> {
  const { check, timeoutMs = 2_000 } = dependency;
  const startedAt = Date.now();

  let timer: NodeJS.Timeout | undefined;
  try {
    // A hung TCP connect would otherwise keep the probe open until the client
    // gives up, which reads as "no answer" rather than "dependency down".
    const result = await Promise.race([
      check(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    if (result === false) throw new Error("check returned false");
    return { status: "up", durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "down",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Liveness: is the process itself alive?
 *
 * Deliberately checks nothing external. An orchestrator restarts a container
 * that fails liveness, and restarting a service because Postgres is down turns
 * one outage into a crash loop.
 */
export function healthHandler(service: string): ObsHandler {
  const startedAt = Date.now();
  return (_req: ObsRequest, res: ObsResponse): void => {
    res.status(200).json({
      status: "ok",
      service,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  };
}

/**
 * Readiness: can this instance serve traffic right now?
 *
 * Fails with 503 when a critical dependency is down, which takes the instance
 * out of the load balancer without killing it.
 */
export function readyHandler(service: string, dependencies: DependencyCheck[]): ObsHandler {
  return (_req: ObsRequest, res: ObsResponse): void => {
    void Promise.all(
      dependencies.map(async (dependency) => [dependency.name, await runCheck(dependency)] as const)
    ).then((entries) => {
      const checks = Object.fromEntries(entries);
      const failed = dependencies.filter(
        (dependency) => dependency.critical !== false && checks[dependency.name].status === "down"
      );

      res.status(failed.length ? 503 : 200).json({
        status: failed.length ? "unavailable" : "ready",
        service,
        ...(failed.length ? { failing: failed.map((dependency) => dependency.name) } : {}),
        checks,
      });
    });
  };
}
