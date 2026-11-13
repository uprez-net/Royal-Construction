// Browser-side Sentry setup. Runs before the app hydrates.
//
// The browser cannot see APP_ENV or VERCEL_ENV, so `next.config.ts` inlines the
// server's answer as NEXT_PUBLIC_ERROR_REPORTING_ENV at build time.

import * as Sentry from "@sentry/nextjs";

import { createBeforeSend } from "@/lib/observability/before-send";
import { DATA_COLLECTION } from "@/lib/observability/data-collection";
import { errorReportingEnabled } from "@/lib/observability/environment";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_ERROR_REPORTING_ENV;

Sentry.init({
  dsn,
  enabled: errorReportingEnabled(environment, dsn),
  environment,
  dataCollection: DATA_COLLECTION,
  // Noise that is not a fault in this app: a layout observer firing mid-resize,
  // and a request that failed because the tab went offline or navigated away.
  // A real API outage shows up server-side.
  ignoreErrors: [
    "ResizeObserver loop completed with undelivered notifications",
    "ResizeObserver loop limit exceeded",
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource",
  ],
  beforeSend: createBeforeSend(),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
