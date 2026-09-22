/**
 * The errors a domain function throws, and the only vocabulary an adapter has
 * to map.
 *
 * Before this taxonomy each layer invented its own: `LeadAccessError` carried
 * an HTTP status, `ProjectAccessError` carried a different one,
 * `AgentAuthorizationError` carried a string code, the offer actions returned
 * `{ ok: false, error }` instead of throwing, and a route handler had to know
 * all four to answer with the right status. A domain function throws one of
 * these; the App adapter maps `status`, the Eve adapter maps `code`, and
 * neither has to guess.
 *
 * Rules that hold everywhere:
 *
 * - A command never returns a success result after a failed write. If the
 *   write did not land, it throws.
 * - `DomainNotFoundError` is also the answer to "exists, but this caller may
 *   not know that" where leaking existence would be a disclosure. Say which
 *   one you mean at the call site; do not make callers guess from the status.
 * - `message` is safe to show an operator. It never contains another record's
 *   data, a stack, or a raw database error.
 */

export type DomainErrorCode =
  | "domain_invalid_input"
  | "domain_unauthorized"
  | "domain_not_found"
  | "domain_stale_version"
  | "domain_transition_unavailable"
  | "domain_side_effect_failed";

/** HTTP statuses the App adapters map these to. */
export type DomainErrorStatus = 400 | 403 | 404 | 409 | 502;

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  abstract readonly status: DomainErrorStatus;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Input that the business rule itself rejects — a close date before the lead
 * was created, a quote amount that is not a positive number, a patch naming a
 * field the workspace allowlist does not carry.
 *
 * Not for shape validation: a transport parses its own payload (Zod at the Eve
 * contract, the route handler's schema) before the domain sees it. This is the
 * rule saying no to well-formed input.
 */
export class DomainValidationError extends DomainError {
  readonly code = "domain_invalid_input";
  readonly status = 400;

  constructor(
    message: string,
    readonly field?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** The caller is known and may not do this. */
export class DomainAuthorizationError extends DomainError {
  readonly code = "domain_unauthorized";
  readonly status = 403;

  constructor(message = "You do not have access to this record.") {
    super(message);
  }
}

/**
 * The record is not there — or is not there *for this caller*, where saying
 * otherwise would disclose that it exists.
 */
export class DomainNotFoundError extends DomainError {
  readonly code = "domain_not_found";
  readonly status = 404;

  constructor(message = "Record not found.") {
    super(message);
  }
}

/**
 * Optimistic concurrency lost: the row moved under the caller between read and
 * write.
 *
 * With two or three staff on a shared login this is rarely two people racing.
 * It is one person with two tabs, a double-click, or a retry after a timeout —
 * which is exactly why the version has to be checked rather than waved through.
 * `expected`/`actual` are for the operator's message ("someone saved this while
 * you were editing"), not for the caller to retry on blindly.
 */
export class DomainStaleVersionError extends DomainError {
  readonly code = "domain_stale_version";
  readonly status = 409;

  constructor(
    message = "This record changed while you were working on it. Reload and try again.",
    readonly expected?: number,
    readonly actual?: number,
  ) {
    super(message);
  }
}

/**
 * The state machine has no edge from here to there — sending an offer that is
 * already signed, completing a milestone on a project that never started.
 *
 * Distinct from `DomainAuthorizationError` on purpose: the caller is allowed,
 * the record simply is not in a state where this means anything.
 */
export class DomainTransitionError extends DomainError {
  readonly code = "domain_transition_unavailable";
  readonly status = 409;

  constructor(
    message: string,
    readonly from?: string,
    readonly to?: string,
  ) {
    super(message);
  }
}

/**
 * An external capability behind a port failed — email, Graph, DocuSign, Xero,
 * Novu, Blob, document generation.
 *
 * Throwing this is the point. Reporting success while the client never got the
 * email is the expensive failure here: with three people and nobody watching
 * logs, the first sign is a customer asking why they never heard back.
 * `retryable` says whether the same call is worth repeating; it does not say
 * the database write was rolled back — the command's own transaction or outbox
 * decides that.
 */
export class DomainSideEffectError extends DomainError {
  readonly code = "domain_side_effect_failed";
  readonly status = 502;

  constructor(
    message: string,
    readonly port: string,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/**
 * The HTTP status for an error, for route handlers that catch broadly.
 * Anything that is not a `DomainError` is a bug, not a rejected request, and
 * answers 500.
 */
export function domainErrorStatus(error: unknown): DomainErrorStatus | 500 {
  return isDomainError(error) ? error.status : 500;
}
