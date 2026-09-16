// Per-signer DocuSign status, surfaced from EnvelopeSignature rows to the
// workspace UI.
//
// Background: the Connect webhook has always WRITTEN per-recipient status into
// EnvelopeSignature, but nothing ever read it back — the Tender and Contract
// panels hard-coded every customer row to "awaiting". So the tracker showed
// "Awaiting signature" even after everyone had signed (#121, #123). This module
// is the shared, testable bridge between the persisted rows and the tracker.
//
// Deliberately free of Prisma imports so client components can use it without
// pulling @prisma/client into the browser bundle; statuses/roles are string
// unions that mirror the SignerStatus / SignerRole enums.

export type OfferSignerRole = "BUILDER" | "CUSTOMER";

// OFFER is the customer-only Offer-document acceptance (ADR 0004); TENDER and
// CONTRACT are the builder + customer legal documents.
export type OfferSignerDocType = "OFFER" | "TENDER" | "CONTRACT";

export type OfferSignerStatusValue =
  | "CREATED"
  | "SENT"
  | "DELIVERED"
  | "SIGNED"
  | "DECLINED";

const SIGNER_STATUS_VALUES: readonly OfferSignerStatusValue[] = [
  "CREATED",
  "SENT",
  "DELIVERED",
  "SIGNED",
  "DECLINED",
];

// Forward-only rank for one recipient's status. DocuSign delivers Connect events
// out of order and redelivers after a failure, so a late "delivered" arriving
// after "completed" used to put a signed customer back to "awaiting". SIGNED and
// DECLINED are both terminal, so neither may replace the other.
export function signerStatusRank(status: OfferSignerStatusValue): number {
  switch (status) {
    case "CREATED":
      return 0;
    case "SENT":
      return 1;
    case "DELIVERED":
      return 2;
    case "SIGNED":
    case "DECLINED":
      return 3;
  }
}

export function shouldApplySignerStatus(
  current: OfferSignerStatusValue,
  next: OfferSignerStatusValue,
): boolean {
  return signerStatusRank(next) > signerStatusRank(current);
}

// The statuses a recipient may move to `next` from. The webhook puts these in
// its update's where clause, so the rank check and the write are one statement
// and two concurrent deliveries cannot both apply.
export function signerStatusesBelow(
  next: OfferSignerStatusValue,
): OfferSignerStatusValue[] {
  return SIGNER_STATUS_VALUES.filter((status) =>
    shouldApplySignerStatus(status, next),
  );
}

// One persisted recipient of a sent envelope.
export type OfferSignerStatus = {
  readonly docType: OfferSignerDocType;
  readonly role: OfferSignerRole;
  readonly name: string;
  readonly email: string;
  readonly status: OfferSignerStatusValue;
  // ISO string (not a Date) so it survives the server → client boundary.
  readonly signedAt: string | null;
  readonly routingOrder: number;
};

// UI states the tracker can render. "waiting_for_prior" is a ROUTING state, not
// a DocuSign one: it means this party's turn has not come up yet.
export type SignerState =
  | "awaiting"
  | "waiting_for_prior"
  | "signed"
  | "declined";

// Map a persisted DocuSign recipient status to the tracker's state.
// CREATED/SENT/DELIVERED all mean "we are waiting on them"; only SIGNED and
// DECLINED are terminal.
export function signerStateFromStatus(
  status: OfferSignerStatusValue,
): SignerState {
  switch (status) {
    case "SIGNED":
      return "signed";
    case "DECLINED":
      return "declined";
    default:
      return "awaiting";
  }
}

/**
 * Find the persisted status for one signer of a given document.
 *
 * Matched by EMAIL, which is the only identifier shared between the offer's
 * owner model and the envelope's recipients — and which `collectOwnerIssues`
 * already forces to be unique per signatory, precisely so signers stay
 * distinguishable. Comparison is trimmed + case-insensitive because DocuSign
 * echoes back whatever casing the recipient used.
 *
 * Returns undefined when the envelope has not been sent yet, or when this
 * signer was added to the offer after the envelope was created — in which case
 * the caller falls back to its routing-derived state rather than inventing one.
 */
export function findSignerStatus(
  statuses: readonly OfferSignerStatus[],
  docType: OfferSignerDocType,
  email: string,
): OfferSignerStatus | undefined {
  const needle = email.trim().toLowerCase();
  if (needle.length === 0) {
    return undefined;
  }
  return statuses.find(
    (entry) =>
      entry.docType === docType &&
      entry.role === "CUSTOMER" &&
      entry.email.trim().toLowerCase() === needle,
  );
}

/** The builder's persisted status for a document, if the envelope exists. */
export function findBuilderStatus(
  statuses: readonly OfferSignerStatus[],
  docType: OfferSignerDocType,
): OfferSignerStatus | undefined {
  return statuses.find(
    (entry) => entry.docType === docType && entry.role === "BUILDER",
  );
}

/**
 * The builder's row state for a customer-first document (both the Tender and
 * the Contract route to the customer first, then the builder counter-signs).
 *
 * Precedence matters: a terminal builder status wins outright, otherwise the
 * builder is "awaiting" once every customer has signed and "waiting_for_prior"
 * until then. Before the envelope exists there are no rows at all, so it falls
 * through to "waiting_for_prior" — which is correct, nobody can sign yet.
 */
export function builderSignerState(
  statuses: readonly OfferSignerStatus[],
  docType: OfferSignerDocType,
): SignerState {
  const builder = findBuilderStatus(statuses, docType);
  if (builder?.status === "SIGNED") {
    return "signed";
  }
  if (builder?.status === "DECLINED") {
    return "declined";
  }
  return allCustomersSigned(statuses, docType)
    ? "awaiting"
    : "waiting_for_prior";
}

/**
 * Have ALL customer signers of a document signed?
 *
 * Used to decide whether the builder is still queued behind the customers
 * ("waiting_for_prior") or is now the party being waited on ("awaiting").
 * False when there are no customer rows at all, so an unsent envelope never
 * reads as "everyone signed".
 */
export function allCustomersSigned(
  statuses: readonly OfferSignerStatus[],
  docType: OfferSignerDocType,
): boolean {
  const customers = statuses.filter(
    (entry) => entry.docType === docType && entry.role === "CUSTOMER",
  );
  return (
    customers.length > 0 && customers.every((entry) => entry.status === "SIGNED")
  );
}
