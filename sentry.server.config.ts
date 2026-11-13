// Server-side Sentry setup, loaded once per server instance by
// `instrumentation.ts`. Production only: everywhere else `enabled` is false and
// the SDK sends nothing (see lib/observability/environment.ts for why that is
// not simply `VERCEL_ENV === "production"`).

import * as Sentry from "@sentry/nextjs";

import { createBeforeSend } from "@/lib/observability/before-send";
import { DATA_COLLECTION } from "@/lib/observability/data-collection";
import {
  errorReportingEnabled,
  reportingEnvironment,
} from "@/lib/observability/environment";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = reportingEnvironment(process.env);

// Tags set once here ride on every event, so no call site has to remember them:
// which deployment, which region, which commit.
const tags: Record<string, string> = {};
for (const [tag, value] of [
  ["deployment_id", process.env.VERCEL_DEPLOYMENT_ID],
  ["region", process.env.VERCEL_REGION],
  ["git_sha", process.env.VERCEL_GIT_COMMIT_SHA],
] as const) {
  if (value) tags[tag] = value;
}

Sentry.init({
  dsn,
  enabled: errorReportingEnabled(environment, dsn),
  environment,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  initialScope: { tags },
  // Errors only: tracing and replay each spend their own quota and nobody is
  // reading performance data. Turn them on deliberately if that changes.
  // What an event may carry is locked down in data-collection.ts.
  dataCollection: DATA_COLLECTION,
  integrations: [
    // ~365 `console.error` calls across the codebase log the cause of a 500 the
    // handler then answers itself, so it never reaches `onRequestError`. Capturing the
    // `error` level is what makes those visible without editing every route.
    // `warn` stays out: it is where handled refusals are logged.
    Sentry.captureConsoleIntegration({ levels: ["error"] }),
  ],
  beforeSend: createBeforeSend(),
});
