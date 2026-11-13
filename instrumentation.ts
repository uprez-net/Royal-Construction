import * as Sentry from "@sentry/nextjs";

export async function register() {
  // Every route, action, page render and the proxy run on Node here, so there
  // is no edge config to load.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

// Next calls this for an error that escapes a route handler, Server Action,
// page render or the proxy. It does not see an error a handler caught and
// answered with a 500 — console capture in `sentry.server.config.ts` and the
// explicit `reportError` calls cover those. `beforeSend` drops refusals.
export const onRequestError = Sentry.captureRequestError;
