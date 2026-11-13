// Wraps a Vercel cron route so a failure of the job is reported, and (when
// enabled) so a job that never ran is noticed.
//
// A cron has no user and no screen. If it fails, nothing is on fire until a
// client asks why the follow-up never went — which is the silent failure the
// rest of this module exists to end.

import { captureCheckIn } from "@sentry/core";

import vercelConfig from "@/vercel.json";

import { reportError } from "./report-error";
import { trackCaptures } from "./run-context";

type CronEntry = { path: string; schedule: string };

const CRONS: readonly CronEntry[] =
  (vercelConfig as { crons?: CronEntry[] }).crons ?? [];

/** The schedule `vercel.json` gives a route, so it is written down once. */
export function cronSchedule(path: string): string | undefined {
  return CRONS.find((cron) => cron.path === path)?.schedule;
}

export function cronSlug(path: string): string {
  return path.replace(/^\/api\/cron\//, "").replace(/\//g, "-");
}

/**
 * Which crons check in to Sentry, from `SENTRY_CRON_MONITORS`: empty (the
 * default) for none, `all`, or a comma-separated list of slugs.
 *
 * Cron monitors are billed apart from errors — the free plan includes ONE, and
 * each further one is an add-on — and a monitor is created by its first
 * check-in. So this is a list, not a switch: name the job whose silence would
 * hurt most. `graph-renew` is the candidate: if the Graph subscription lapses,
 * inbound lead capture stops after a few days and nothing says so.
 */
export function monitoredCrons(
  value: string | undefined = process.env.SENTRY_CRON_MONITORS,
): { all: boolean; slugs: ReadonlySet<string> } {
  const trimmed = (value ?? "").trim();
  if (trimmed === "all" || trimmed === "1") {
    return { all: true, slugs: new Set() };
  }
  return {
    all: false,
    slugs: new Set(
      trimmed
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean),
    ),
  };
}

function monitorsEnabled(slug: string): boolean {
  const { all, slugs } = monitoredCrons();
  return all || slugs.has(slug);
}

/**
 * Vercel's own scheduler sends `user-agent: vercel-cron/1.0`. A 401 to THAT
 * caller means `CRON_SECRET` no longer matches, and every cron is then dead
 * every night with nothing logged. A 401 to anyone else is a stranger hitting a
 * public URL and is not worth an email. (A user-agent can be forged, so the
 * worst a forger gets is one throttled event.)
 */
function isVercelCron(request: unknown): boolean {
  const headers = (
    request as { headers?: { get?: (name: string) => string | null } }
  )?.headers;
  return (headers?.get?.("user-agent") ?? "").startsWith("vercel-cron");
}

// A handler that finishes with some items failed still answers 200: one bad
// engagement must not stop the rest, so the failure is counted, not thrown. The
// response is what the wrapper sees, so the count rides on it out of band,
// leaving the body, status and headers the caller gets exactly as they were.
const OUTCOMES = new WeakMap<Response, { failed: number }>();

/**
 * Tell the wrapper how a run went, from inside a handler that tolerates
 * per-item failures:
 *
 * ```ts
 * return cronOutcome(successResponse({ processed, failed }), { failed });
 * ```
 *
 * A run with `failed > 0` closes its monitor check-in as an error even though
 * the response is a 200. The individual failures are logged where they happen.
 * Returns the response it was given, untouched.
 */
export function cronOutcome<R extends Response>(
  response: R,
  outcome: { failed: number },
): R {
  OUTCOMES.set(response, outcome);
  return response;
}

/**
 * One check-in at the end of the run, and only for a run that was authenticated.
 *
 * Not an `in_progress` check-in followed by a closing one, because the first
 * would have to be sent before the handler has checked `CRON_SECRET`. A request
 * from anyone with the URL would then open a check-in, and a rejected 401 would
 * close it as a success — a stranger could keep a dead job looking healthy. A
 * rejected request sends nothing, so a job that stops being authenticated
 * simply stops checking in, and the monitor reports it missed.
 */
function heartbeat(
  slug: string,
  schedule: string | undefined,
  status: "ok" | "error",
): void {
  if (!monitorsEnabled(slug) || !schedule) return;
  try {
    captureCheckIn(
      { monitorSlug: slug, status },
      // Vercel evaluates cron expressions in UTC.
      {
        schedule: { type: "crontab", value: schedule },
        timezone: "UTC",
        // A run that has not reported in this long counts as missed.
        checkinMargin: 10,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    );
  } catch {
    // A monitor that cannot be reached must not fail the job it watches.
  }
}

/**
 * ```ts
 * async function handle(request: Request) { … }
 * export const GET = withCronReporting("/api/cron/tradie-reminders", handle);
 * ```
 *
 * - A thrown error is reported and rethrown, so the route still answers 500.
 * - A 5xx the handler answered itself is reported only if nothing was reported
 *   during the run. A handler that logs its failure has already produced an
 *   event with the real stack; a second "cron answered 500" would be a second
 *   issue and a second email for one failure. One that answers 500 in silence
 *   still gets the fallback.
 * - A 401 to Vercel's own scheduler is reported as a secret mismatch; a 401 to
 *   anyone else, and other 4xx, are not failures of the job.
 * - A run that reports failed items through `cronOutcome` closes its monitor
 *   check-in as an error even though it answered 200.
 */
export function withCronReporting<A extends unknown[], R extends Response>(
  path: string,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const slug = cronSlug(path);
  const schedule = cronSchedule(path);
  const source = `cron:${slug}`;

  return (...args: A): Promise<R> =>
    trackCaptures(async (run) => {
      try {
        const response = await handler(...args);
        if (response.status >= 500) {
          if (run.captured === 0) {
            reportError(new Error(`Cron ${path} answered ${response.status}`), {
              source,
              // One issue per job however many times it fails, not one per message.
              fingerprint: ["cron-5xx", slug],
              extra: { status: response.status },
            });
          }
          heartbeat(slug, schedule, "error");
        } else if (response.status === 401) {
          // No check-in: this request was not authenticated, so it says nothing
          // about whether the job ran.
          if (isVercelCron(args[0])) {
            reportError(
              new Error(
                `Cron ${path} rejected Vercel's own request with a 401: CRON_SECRET does not match what the project sends.`,
              ),
              {
                source,
                // One issue for the whole fleet, not nine: they all fail together.
                fingerprint: ["cron-unauthorised"],
              },
            );
          }
        } else if ((OUTCOMES.get(response)?.failed ?? 0) > 0) {
          heartbeat(slug, schedule, "error");
        } else if (response.status < 400) {
          heartbeat(slug, schedule, "ok");
        }
        return response;
      } catch (error) {
        reportError(error, { source });
        heartbeat(slug, schedule, "error");
        throw error;
      }
    });
}
