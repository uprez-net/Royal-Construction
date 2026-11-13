// Reports failures from a vendor SDK, without editing each call site.
//
// DocuSign, Xero, Blob and Novu are reached from many places, each of which
// catches the failure and answers the screen or logs it. Hooking the object or
// function once means a failed `createInvoices` or `put` is reported with the
// vendor and the operation, grouped so an outage is one issue, from wherever it
// was called.
//
// The caller still gets exactly what it got before: the same promise, rejecting
// with the same error. Reporting is a side channel and never changes the flow.

import { reportExternalError, type ExternalService } from "./external";

const INSTRUMENTED = new WeakSet<object>();

/** True once `instrumentApi` has wrapped this object. */
export function isInstrumented(api: object): boolean {
  return INSTRUMENTED.has(api);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as { then?: unknown }).then === "function"
  );
}

export interface InstrumentOptions {
  /**
   * Narrows what counts as a failure of the vendor. Used where the SDK has its
   * own error classes and no HTTP status, so the generic status rules cannot
   * tell a missing file (expected) from a suspended store (an outage).
   * When set, an error that passes is reported with any status.
   */
  shouldReport?: (error: unknown) => boolean;
}

function report(
  service: ExternalService,
  operation: string,
  error: unknown,
  options: InstrumentOptions,
): void {
  if (options.shouldReport) {
    let wanted = false;
    try {
      wanted = options.shouldReport(error);
    } catch {
      // A predicate that throws must not hide the failure it was asked about.
      wanted = true;
    }
    if (!wanted) return;
    reportExternalError(service, operation, error, { force: true });
    return;
  }
  reportExternalError(service, operation, error);
}

/**
 * Run `call`, reporting a synchronous throw or a rejection, and hand the caller
 * the very same result or error.
 */
function observe<T>(
  service: ExternalService,
  operation: string,
  options: InstrumentOptions,
  call: () => T,
): T {
  let result: T;
  try {
    result = call();
  } catch (error) {
    report(service, operation, error, options);
    throw error;
  }
  if (isThenable(result)) {
    // A derived promise that swallows the rejection for the reporter only; the
    // caller still holds, and handles, the original.
    result.then(undefined, (error: unknown) =>
      report(service, operation, error, options),
    );
  }
  return result;
}

/**
 * Wrap one function so a failing call is reported.
 *
 * ```ts
 * export const put = instrumentFunction("blob", "put", () => blob.put);
 * ```
 *
 * `resolve` is called on every use rather than once, so a module that is only
 * partly present (a test double that provides `put` and nothing else) fails at
 * the call that needs the missing part, not at import.
 */
export function instrumentFunction<Args extends unknown[], Result>(
  service: ExternalService,
  operation: string,
  resolve: () => (...args: Args) => Result,
  options: InstrumentOptions = {},
): (...args: Args) => Result {
  return (...args: Args): Result =>
    observe(service, operation, options, () => resolve()(...args));
}

/**
 * Wrap an SDK API object so a failing async method is reported.
 *
 * ```ts
 * client.accountingApi = instrumentApi("xero", client.accountingApi);
 * ```
 *
 * A method that throws synchronously and one that returns a rejecting promise
 * are both reported, once, and the original error still reaches the caller.
 */
export function instrumentApi<T extends object>(
  service: ExternalService,
  api: T,
  options: InstrumentOptions = {},
): T {
  const proxy = new Proxy(api, {
    get(target, property) {
      // `target` as the receiver so getters and private state resolve on the
      // real object, not on the proxy.
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function" || typeof property !== "string") {
        return value;
      }
      if (property === "constructor") return value;
      return (...args: unknown[]) =>
        observe(service, property, options, () =>
          Reflect.apply(value, target, args),
        );
    },
  });
  INSTRUMENTED.add(proxy);
  return proxy;
}
