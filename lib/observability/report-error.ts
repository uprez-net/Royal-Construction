// Report a failure to the error tracker, with enough detail to find it.
//
// Imports `@sentry/core`, not `@sentry/nextjs`, on purpose. The Next SDK pulls
// in `next/*`, and a value import of that from anything Eve bundles (`agent/`
// and the application modules it reaches) fails `eve build`. Core is plain
// Node and browser safe, and it reports through whichever client was set up by
// `sentry.server.config.ts` / `instrumentation-client.ts` — with no client
// (local dev, staging, tests, the Eve service until it is wired) every call
// here is a no-op.
//
// Reporting must never be the thing that breaks a request: nothing in here
// throws.

import { captureException, flush, withScope } from "@sentry/core";

import { EXPLICIT_TAG } from "./before-send";
import { isExpectedError, markReported, wasReported } from "./filter";
import { carryReportAcrossSteps } from "./workflow-context";

export type ErrorLevel = "warning" | "error" | "fatal";

export interface ErrorContext {
  /**
   * Where it happened, as a short stable label: `route:POST /api/leads`,
   * `cron:sync-sent-mail`, `webhook:docusign`. It is the first thing read in the
   * email, so name the operation, not the file.
   */
  source: string;
  /** The Clerk user id behind the request. An id only — never a name or email. */
  userId?: string;
  /** Record ids that narrow it down: `{ leadId, projectId, envelopeId }`. */
  ids?: Record<string, string | number | null | undefined>;
  /** Anything else useful that is not client data. Strings are redacted. */
  extra?: Record<string, unknown>;
  level?: ErrorLevel;
  /** Override Sentry's grouping when the stack is not what makes it distinct. */
  fingerprint?: string[];
  /** Extra searchable tags, e.g. `{ service: "graph" }`. */
  tags?: Record<string, string | number | undefined>;
}

/**
 * Vercel freezes a function once its response is sent, so an event still in
 * the SDK's queue can be lost. Hand the flush to the platform's `waitUntil`
 * (the same request-context hook `@vercel/functions` reads) so it finishes
 * after the response, and fall back to a plain fire-and-forget locally.
 */
export function flushAfterResponse(): void {
  const flushing = flush(2000).catch(() => false);
  try {
    const context = (globalThis as Record<symbol, unknown>)[
      Symbol.for("@vercel/request-context")
    ] as
      | { get?: () => { waitUntil?: (p: Promise<unknown>) => void } }
      | undefined;
    context?.get?.()?.waitUntil?.(flushing);
  } catch {
    // No request context (a cron callback, a test): the promise still runs.
  }
}

let captureObserver: (() => void) | undefined;

/**
 * Registers a function called synchronously, as an explicit report is made.
 * The server uses it to tell a running cron that an error was reported; it is a
 * hook rather than an import because this module also ships to the browser and
 * the server's bookkeeping needs Node.
 */
export function observeCaptures(observer: () => void): void {
  captureObserver = observer;
}

/** Sends the event. Callers have already decided it is worth sending. */
export function captureWithContext(
  error: unknown,
  context: ErrorContext,
): void {
  try {
    markReported(error);
    try {
      captureObserver?.();
    } catch {
      // Bookkeeping for the caller must never stop the report it observes.
    }
    withScope((scope) => {
      scope.setTag(EXPLICIT_TAG, "1");
      scope.setTag("source", context.source);
      if (context.tags) {
        for (const [key, value] of Object.entries(context.tags)) {
          if (value !== undefined) scope.setTag(key, String(value));
        }
      }
      scope.setLevel(context.level ?? "error");
      if (context.userId) scope.setUser({ id: context.userId });
      if (context.ids) {
        const ids = Object.fromEntries(
          Object.entries(context.ids).filter(([, v]) => v != null),
        );
        if (Object.keys(ids).length > 0) scope.setContext("ids", ids);
      }
      if (context.extra) scope.setContext("details", context.extra);
      if (context.fingerprint) scope.setFingerprint(context.fingerprint);
      captureException(error);
    });
    // After the capture, so the marker is not part of what was sent. Only does
    // anything inside a workflow step; see workflow-context.ts.
    carryReportAcrossSteps(error);
    flushAfterResponse();
  } catch {
    // Never let reporting fail the request that is already failing.
  }
}

/**
 * Report an unexpected failure. A refusal (`DomainError`, a validation error,
 * a 4xx) is dropped here, so a catch block can call this without first asking
 * what kind of error it holds.
 */
export function reportError(error: unknown, context: ErrorContext): void {
  try {
    if (wasReported(error) || isExpectedError(error)) return;
  } catch {
    return;
  }
  captureWithContext(error, context);
}
