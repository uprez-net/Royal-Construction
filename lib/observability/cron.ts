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

// Sentry cron monitors are a separate quota from errors, and a monitor is
// created from the first check-in. Off until someone has looked at what the
// plan allows; set SENTRY_CRON_MONITORS=1 to turn on missed-run detection.
function monitorsEnabled(): boolean {
  return process.env.SENTRY_CRON_MONITORS === "1";
}

function checkIn(
  slug: string,
  schedule: string | undefined,
  status: "in_progress" | "ok" | "error",
  checkInId?: string,
): string | undefined {
  if (!monitorsEnabled() || !schedule) return undefined;
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
 * answer 500 without logging it. A 401 (a request without the secret) and
 * other 4xx are not failures of the job.
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
