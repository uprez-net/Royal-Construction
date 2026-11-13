// Whether this process should send errors anywhere.
//
// Pure on purpose: the server config, the browser config and the tests all ask
// the same question, and `next.config.ts` imports it before any alias exists.
//
// "Production" is NOT `VERCEL_ENV === "production"` on its own. The staging
// project is a separate Vercel project whose own domain reports
// `VERCEL_ENV=production`, so that check alone would send staging's errors to
// the office inbox. `notificationEnvironment` already encodes the rule the app
// uses everywhere else (`APP_ENV=staging` wins, then `VERCEL_ENV`), so this
// reuses it instead of inventing a second definition of "production".

import {
  notificationEnvironment,
  type NotificationEnvironment,
} from "@/lib/notification/environment";

export type ReportingEnvironment = NotificationEnvironment;

/** The deployment this server is, for the `environment` tag on every event. */
export function reportingEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): ReportingEnvironment {
  return notificationEnvironment(env);
}

/**
 * Tags that ride on every event from a server, so no call site has to remember
 * them: which service raised it, on which deployment, in which region, at which
 * commit. `service` tells an app error from an agent error in the one project.
 */
export function deploymentTags(
  env: Readonly<Record<string, string | undefined>>,
  service: "app" | "eve",
): Record<string, string> {
  const tags: Record<string, string> = { service };
  for (const [tag, value] of [
    ["deployment_id", env.VERCEL_DEPLOYMENT_ID],
    ["region", env.VERCEL_REGION],
    ["git_sha", env.VERCEL_GIT_COMMIT_SHA],
  ] as const) {
    if (value) tags[tag] = value;
  }
  return tags;
}

/**
 * True only for the production deployment with a DSN configured.
 *
 * The browser cannot read `APP_ENV`/`VERCEL_ENV` (neither is `NEXT_PUBLIC_`),
 * so `next.config.ts` inlines the server's answer as
 * `NEXT_PUBLIC_ERROR_REPORTING_ENV` at build time and the browser passes it
 * here as `environment`.
 */
export function errorReportingEnabled(
  environment: string | undefined,
  dsn: string | undefined,
): boolean {
  return environment === "production" && Boolean(dsn?.trim());
}
