// Error reporting for the Eve agent service.
//
// The agent runs as its own Vercel service (`/eve/v1/*`), a separate process
// from the Next app, so `instrumentation.ts` and `sentry.server.config.ts` never
// run there and every `reportError` call made from agent code was a no-op. This
// initialises the Node SDK in the agent's own process and turns Eve's failure
// events into reports.
//
// `@sentry/node`, not `@sentry/nextjs`: authored agent code cannot import
// packages that need a Next bundler (see AGENTS.md). Shared reporting code
// imports `@sentry/core`, and both SDKs resolve to the one copy, so
// `reportError` called from a tool reaches this client.

import * as Sentry from "@sentry/node";

import { createBeforeSend } from "@/lib/observability/before-send";
import { DATA_COLLECTION } from "@/lib/observability/data-collection";
import {
  deploymentTags,
  errorReportingEnabled,
  reportingEnvironment,
} from "@/lib/observability/environment";
import { reportExternalError } from "@/lib/observability/external";
import { reportError } from "@/lib/observability/report-error";

/**
 * Runs once at agent startup, from the instrumentation provider's `setup`.
 * Idempotent: a second call, or a client someone else already made, is left alone.
 */
export function initEveErrorReporting(): void {
  if (Sentry.isInitialized()) return;

  // The Vercel integration names the DSN for the browser; it is also an
  // ordinary environment variable in the agent's process.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
  const environment = reportingEnvironment(process.env);

  Sentry.init({
    dsn,
    // Same gate as the app: production only, never preview or staging.
    enabled: errorReportingEnabled(environment, dsn),
    environment,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    initialScope: { tags: deploymentTags(process.env, "eve") },
    dataCollection: DATA_COLLECTION,
    // Deliberately bare. The defaults install HTTP and database instrumentation
    // and process-level crash handlers, none of which this needs to report an
    // error, and a crash handler changes how a durable runtime dies. What is
    // left: `console.error`, explicit reports, and the failure events below.
    defaultIntegrations: false,
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ["error"] }),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
    ],
    beforeSend: createBeforeSend(),
  });
}

/** Eve calls this before a session goes idle; a serverless process may then freeze. */
export async function flushEveErrorReporting(): Promise<void> {
  await Sentry.flush(2000).catch(() => false);
}

/**
 * Eve hands a failure over as `unknown`: an `Error`, a serialised
 * `{ name, message }`, a string, or nothing at all when the trace policy is not
 * recording that direction.
 */
export function failureToError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value) return new Error(value);
  if (typeof value === "object" && value !== null) {
    const { name, message, stack, status } = value as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
      status?: unknown;
    };
    if (typeof message === "string" && message) {
      const error = new Error(message);
      if (typeof name === "string") error.name = name;
      if (typeof stack === "string") error.stack = stack;
      if (typeof status === "number") Object.assign(error, { status });
      return error;
    }
  }
  return new Error(fallback);
}

type SessionIds = { sessionId?: string; turnId?: string };

function ids(event: SessionIds): Record<string, string | undefined> {
  return { sessionId: event.sessionId, turnId: event.turnId };
}

/**
 * The failure events worth an email, as the `events` of an instrumentation
 * provider. Events that mean "retrying" (`step.attempt.failed`) or "the user
 * said no" (`action.failed` with outcome `rejected`, `cancelled`) are left out:
 * neither is a fault.
 */
export const eveFailureHandlers = {
  "turn.failed": (event: SessionIds & { error?: unknown }) => {
    reportError(failureToError(event.error, "An agent turn failed."), {
      source: "eve:turn.failed",
      ids: ids(event),
      fingerprint: ["eve", "turn.failed"],
    });
  },
  "session.failed": (event: SessionIds & { error?: unknown }) => {
    reportError(failureToError(event.error, "An agent session failed."), {
      source: "eve:session.failed",
      ids: ids(event),
      fingerprint: ["eve", "session.failed"],
    });
  },
  "model.call.failed": (event: { error?: unknown; scope?: SessionIds }) => {
    // The model provider is an outside service like any other: a 5xx or a
    // dropped connection is an outage, a 4xx is a refused request.
    reportExternalError(
      "ai",
      "model.call",
      failureToError(event.error, "A model call failed."),
      { ids: ids(event.scope ?? {}) },
    );
  },
  "action.failed": (event: {
    outcome?: string;
    errorCode?: string;
    error?: unknown;
    scope?: SessionIds;
  }) => {
    // `rejected` is the operator declining an approval, `cancelled` is a stop
    // button, `abandoned` is a session that went away. Only `failed` is a fault.
    if (event.outcome !== "failed") return;
    reportError(failureToError(event.error, "An agent action failed."), {
      source: "eve:action.failed",
      ids: ids(event.scope ?? {}),
      tags: { error_code: event.errorCode },
      fingerprint: ["eve", "action.failed", event.errorCode ?? "unknown"],
    });
  },
  "channel.delivery.failed": (
    event: SessionIds & { error?: unknown; errorCode?: string },
  ) => {
    // The answer was produced and could not be handed to the person waiting.
    reportError(failureToError(event.error, "A channel delivery failed."), {
      source: "eve:channel.delivery.failed",
      ids: ids(event),
      tags: { error_code: event.errorCode },
      fingerprint: ["eve", "channel.delivery.failed"],
    });
  },
  "memory.operation.failed": (event: SessionIds & { error?: unknown }) => {
    reportError(
      failureToError(event.error, "An agent memory operation failed."),
      {
        source: "eve:memory.operation.failed",
        ids: ids(event),
        fingerprint: ["eve", "memory.operation.failed"],
      },
    );
  },
};
