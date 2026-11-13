import type { DataCollection } from "@sentry/core";

// What the SDK may attach to an event, set once for the server and the browser.
//
// Sentry 11 replaced `sendDefaultPii` with `dataCollection`, and its defaults
// collect nearly everything: cookies, headers, request and response bodies,
// query strings, database query data, and the value of every local variable in
// a stack frame. This app handles clients' names, emails, phone numbers and
// site addresses, and an AI conversation can contain all of them. None of it is
// needed to find a bug, so everything is off and an event carries what
// `reportError` puts on it deliberately: a source label, a few tags, record
// ids, and the Clerk user id.
//
// Free-text inside an error MESSAGE is still possible (a provider echoing a
// recipient), which is what `redact.ts` strips before an event leaves.
export const DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
};
