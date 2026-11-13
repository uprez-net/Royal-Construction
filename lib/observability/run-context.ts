// Knowing whether something was already reported during one run of a handler.
//
// Server only: this uses AsyncLocalStorage, so nothing that ships to the
// browser may import it. The browser config does not.
//
// The cron wrapper uses it to avoid a second report. A handler that fails
// usually logs the cause with `console.error` (captured as an event with the
// real stack) and then answers 500; adding a "the cron answered 500" event on
// top opens a second issue, and sends a second email, for one failure. The
// wrapper still wants that event for a handler that answers 500 WITHOUT
// logging, so it asks: was an error logged or reported while this run was in
// progress?
//
// It is noted at the moment of the call, not when the event reaches
// `beforeSend`. The SDK processes an event asynchronously, so by then the
// handler has returned and the wrapper has already looked. An end-to-end run
// found exactly that: both events went out.

import { AsyncLocalStorage } from "node:async_hooks";

export interface CaptureState {
  /** `console.error` calls and explicit reports made while the run was in progress. */
  captured: number;
}

const runs = new AsyncLocalStorage<CaptureState>();

/** Runs `run` with a counter that `noteCaptured` increments. */
export function trackCaptures<T>(
  run: (state: CaptureState) => Promise<T>,
): Promise<T> {
  const state: CaptureState = { captured: 0 };
  return runs.run(state, () => run(state));
}

/**
 * Records that an error was logged or reported. A no-op outside a tracked run,
 * and it never throws: it is called from inside `console.error`.
 */
export function noteCaptured(): void {
  const state = runs.getStore();
  if (state) state.captured += 1;
}

const WRAPPED = Symbol.for("royal.observability.console-error-tracked");

/**
 * Makes every `console.error` count as "something was logged" for the run it is
 * called in. Installed once at server start; a second call does nothing. The
 * call is passed through untouched, so the SDK's console capture, and anything
 * else listening, still sees exactly what it did before.
 */
export function trackConsoleErrors(): void {
  const target = console as typeof console & { [WRAPPED]?: boolean };
  if (target[WRAPPED]) return;
  const original = console.error;
  console.error = function trackedConsoleError(
    this: unknown,
    ...args: unknown[]
  ) {
    noteCaptured();
    return original.apply(this ?? console, args);
  };
  target[WRAPPED] = true;
}
