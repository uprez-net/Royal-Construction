import { defineInstrumentation } from "eve/instrumentation";

import {
  eveFailureHandlers,
  flushEveErrorReporting,
  initEveErrorReporting,
} from "@/agent/lib/error-reporting";

// Reports the agent's failures to Sentry. See agent/lib/error-reporting.ts.
export default defineInstrumentation({
  // Eve withholds an event's `error` unless the policy records outputs, and the
  // message is the whole point of a report. Nothing else from the output
  // direction is read: the handlers take an error's name and message only, and
  // `beforeSend` redacts emails, phones and tokens from it. Scoped to this file;
  // other providers keep their own policy.
  tracePolicy: () => ({ emit: true, recordInputs: false, recordOutputs: true }),
  setup: initEveErrorReporting,
  flush: flushEveErrorReporting,
  events: eveFailureHandlers,
});
