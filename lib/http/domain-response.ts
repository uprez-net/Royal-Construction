import {
  DomainSideEffectError,
  isDomainError,
  type DomainError,
} from "@/lib/domain/errors";
import { reportError } from "@/lib/observability/report-error";
import { errorResponse } from "@/utils/validators/response";

/**
 * A refusal (400, 403, 404, 409) is the app saying no and needs no one. A
 * `DomainSideEffectError` (502) is the command failing to do the outside thing
 * — the email never sent, the envelope DocuSign refused — and the adapters that
 * call this answer the screen and return, so nothing else would ever log it.
 * Reporting it here covers every route and action that surfaces a refusal.
 */
function reportSideEffectFailure(error: DomainError): void {
  if (error.status < 500) return;
  const port = error instanceof DomainSideEffectError ? error.port : "unknown";
  reportError(error, {
    source: `domain:${port}`,
    tags: { port },
    // One issue per failing port, however many requests hit it.
    fingerprint: ["domain-side-effect", port],
    extra:
      error instanceof DomainSideEffectError
        ? { retryable: error.retryable }
        : undefined,
  });
}

// One mapping from a domain refusal to the answer a screen receives.
//
// `lib/domain/errors.ts` gave every refusal a `status` and a `code` so that
// adapters would stop inventing their own. Route handlers then kept inventing
// their own anyway — most of them catch broadly and answer
// `errorResponse("Failed to …", { status: 500, code: "INTERNAL_ERROR" })`,
// which turns "This variation was already approved." and "You do not have
// access to this project." into the same blank wall.
//
// That matters more here than the shared-admin argument suggests. With two or
// three people and nobody watching logs, the operator IS the error reporting:
// if the screen does not say what went wrong, nothing does, and the usual next
// move is to press the button again — which is how a double-decided variation
// or a re-sent email happens.
//
// A 500 stays a 500 for anything that is not a `DomainError`. An unexpected
// throw is a bug, not a rejected request, and its message is not safe to show.

/**
 * The response for a refusal a domain command threw, or `null` when the error
 * is not one — so the caller can fall through to its own 500.
 *
 * ```ts
 * } catch (error) {
 *   const refusal = domainErrorResponse(error);
 *   if (refusal) return refusal;
 *   console.error("…", error);
 *   return errorResponse("…", { status: 500, code: "INTERNAL_ERROR" });
 * }
 * ```
 */
export function domainErrorResponse(error: unknown) {
  if (!isDomainError(error)) return null;
  reportSideEffectFailure(error);
  return errorResponse(error.message, {
    status: error.status,
    code: domainErrorCode(error),
  });
}

/**
 * The stable string a client switches on.
 *
 * Upper-cased from `DomainErrorCode` so it reads like every other code this
 * API returns (`VALIDATION_ERROR`, `INTERNAL_ERROR`) rather than introducing a
 * second casing convention next to them.
 */
export function domainErrorCode(error: DomainError): string {
  return error.code.toUpperCase();
}

/**
 * What a Server Action returns for a refusal, since a thrown message does not
 * survive that boundary — Next replaces it with an opaque digest in
 * production, and a custom class loses its prototype along the way.
 *
 * Actions that already have a richer result shape (the create-project wizard's
 * `CreateProjectFailure`, which binds a blocker to the form field that caused
 * it) keep theirs; this is for the ones whose alternative is a bare string.
 */
export type DomainActionFailure = {
  readonly ok: false;
  readonly code: string;
  readonly status: number;
  readonly error: string;
  /** The input the refusal is about, when the rule named one. */
  readonly field?: string;
};

export function domainActionFailure(
  error: unknown,
): DomainActionFailure | null {
  if (!isDomainError(error)) return null;
  reportSideEffectFailure(error);
  const field = (error as DomainError & { field?: string }).field;
  return {
    code: domainErrorCode(error),
    error: error.message,
    ok: false,
    status: error.status,
    ...(field ? { field } : {}),
  };
}
