// Reports failures from every method of a vendor SDK object, without editing
// each call site.
//
// DocuSign and Xero are reached from about twenty places, each of which catches
// the failure and answers the screen or logs it. Hooking the object once means a
// failed `createInvoices` or `getEnvelope` is reported with the vendor and the
// operation, grouped so an outage is one issue, from wherever it was called.
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
      return (...args: unknown[]) => {
        let result: unknown;
        try {
          result = Reflect.apply(value, target, args);
        } catch (error) {
          reportExternalError(service, property, error);
          throw error;
        }
        if (isThenable(result)) {
          // A derived promise that swallows the rejection for the reporter
          // only; the caller still holds, and handles, the original.
          result.then(undefined, (error: unknown) =>
            reportExternalError(service, property, error),
          );
        }
        return result;
      };
    },
  });
  INSTRUMENTED.add(proxy);
  return proxy;
}
