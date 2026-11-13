// Wraps a Vercel cron route so a failure of the job is reported, and (when
// enabled) so a job that never ran is noticed.
//
// A cron has no user and no screen. If it fails, nothing is on fire until a
// client asks why the follow-up never went — which is the silent failure the
// rest of this module exists to end.

import { captureCheckIn } from "@sentry/core";

import vercelConfig from "@/vercel.json";

import { reportError } from "./report-error";

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

function checkIn(
  slug: string,
  schedule: string | undefined,
  status: "in_progress" | "ok" | "error",
  checkInId?: string,
): string | undefined {
  if (!monitorsEnabled(slug) || !schedule) return undefined;
  try {
    // The SDK types an in-progress check-in (no id yet) separately from a
    // finished one (which must name the run it closes).
    let checkin: Parameters<typeof captureCheckIn>[0];
    if (status === "in_progress") {
      checkin = { monitorSlug: slug, status };
    } else if (checkInId) {
      checkin = { monitorSlug: slug, status, checkInId };
    } else {
      return undefined;
    }
    return captureCheckIn(
      checkin,
      // Vercel evaluates cron expressions in UTC.
      {
        schedule: { type: "crontab", value: schedule },
        timezone: "UTC",
        // A run that has not reported in this long counts as missed.
        checkinMargin: 10,
        maxRuntime: 15,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    );
  } catch {
    return undefined;
  }
}

/**
 * ```ts
 * async function handle(request: Request) { … }
 * export const GET = withCronReporting("/api/cron/tradie-reminders", handle);
 * ```
 *
 * A thrown error is reported and rethrown, so the route still answers 500. A
 * 5xx response is reported too: some handlers catch their own failure and
 * answer 500 without logging it. A 401 to Vercel's own scheduler is reported as
 * a secret mismatch; a 401 to anyone else, and other 4xx, are not failures of
 * the job.
 */
export function withCronReporting<A extends unknown[], R extends Response>(
  path: string,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const slug = cronSlug(path);
  const schedule = cronSchedule(path);
  const source = `cron:${slug}`;

  return async (...args: A): Promise<R> => {
    const checkInId = checkIn(slug, schedule, "in_progress");
    try {
      const response = await handler(...args);
      if (response.status >= 500) {
        reportError(new Error(`Cron ${path} answered ${response.status}`), {
          source,
          // One issue per job however many times it fails, not one per message.
          fingerprint: ["cron-5xx", slug],
          extra: { status: response.status },
        });
        checkIn(slug, schedule, "error", checkInId);
      } else if (response.status === 401 && isVercelCron(args[0])) {
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
        checkIn(slug, schedule, "error", checkInId);
      } else {
        checkIn(slug, schedule, "ok", checkInId);
      }
      return response;
    } catch (error) {
      reportError(error, { source });
      checkIn(slug, schedule, "error", checkInId);
      throw error;
    }
  };
}
