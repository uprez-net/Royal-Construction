import { EnvelopeStatus, type OfferStatus } from "@prisma/client";
import { isLiveEnvelopeStatus } from "./envelope-status";

// Directive-free so the Connect webhook's completion rules can be unit-tested
// without Prisma's client, DocuSign or Blob.

// Which parent an executed PDF is filed against, and the blob name's prefix.
export type ExecutedDocumentPrefix = "tender" | "contract" | "offer";

// What one completion event means for the offer.
//
// - "stale-sibling": a newer envelope exists for the same document, so this one
//   is not the document in play. Nothing is filed against the parent.
// - "advance": the offer is waiting on exactly this signature.
// - "legit-replay": this envelope already advanced the offer; DocuSign is
//   delivering the event again (a retry after a 500, or a manual republish).
// - "unexpected": the envelope was recalled, voided or replaced, yet DocuSign
//   reports it signed. Filing it as the executed document would put a
//   withdrawn document on the project, so it is recorded and escalated instead.
export type CompletionKind =
  | "stale-sibling"
  | "advance"
  | "legit-replay"
  | "unexpected";

export type CompletionFacts = {
  readonly isLatest: boolean;
  readonly isActive: boolean;
  readonly offerStatus: OfferStatus;
  readonly expectedFromStatus: OfferStatus;
  // The envelope's status in our database before this delivery touched it.
  readonly envelopeDbStatusBefore: EnvelopeStatus;
  readonly advancedByThisEnvelope: boolean;
  // An UNEXPECTED_COMPLETION event already exists for this envelope.
  readonly flaggedUnexpected: boolean;
};

export function classifyCompletion(facts: CompletionFacts): CompletionKind {
  // Once unexpected, always unexpected. Recording it rewrote the row from VOIDED
  // to COMPLETED, so from the row alone a redelivery looked like a retry of a
  // real signature and filed the withdrawn document. Checked before
  // stale-sibling too, so a signed copy whose first archive failed is still
  // stored after a newer envelope goes out.
  if (facts.flaggedUnexpected) {
    return "unexpected";
  }
  if (!facts.isLatest) {
    return "stale-sibling";
  }
  // COMPLETED counts as signable: a retry after a failure part-way through the
  // first delivery finds the envelope already COMPLETED and must still advance.
  // VOIDED does not: recall and revision write it only once DocuSign confirms
  // the void, so a completion over it is not a signature we asked for.
  const before = facts.envelopeDbStatusBefore;
  const signable =
    isLiveEnvelopeStatus(before) || before === EnvelopeStatus.COMPLETED;
  if (
    facts.isActive &&
    facts.offerStatus === facts.expectedFromStatus &&
    signable
  ) {
    return "advance";
  }
  if (facts.advancedByThisEnvelope) {
    return "legit-replay";
  }
  return "unexpected";
}

// Whether a decline may move the offer to its *_DECLINED status. A customer can
// decline only an envelope still out for signature; DECLINED is let through so
// a retry after a failure part-way through the first delivery still moves the
// offer. VOIDED is not: recall and revision write it only once DocuSign
// confirms the void, so the document was withdrawn, as for a completion over it.
export function isDeclinableEnvelopeStatus(before: EnvelopeStatus): boolean {
  return isLiveEnvelopeStatus(before) || before === EnvelopeStatus.DECLINED;
}

// The advance's status event starts with this, so a later delivery can tell a
// replay of a signature that moved the offer from one that never did.
const COMPLETED_NOTE_PREFIX = "DOCUSIGN_COMPLETED";

export function completedEventNotePrefix(docusignId: string): string {
  return `${COMPLETED_NOTE_PREFIX} ${docusignId}`;
}

export function completedEventNote(docusignId: string): string {
  return `${completedEventNotePrefix(docusignId)}: every recipient signed`;
}

// The note the advance wrote before the prefix existed. Matched too, so a
// replay for an offer signed before this change is not escalated as unexpected.
export function legacyCompletedEventNote(docusignId: string): string {
  return `DocuSign envelope ${docusignId} completed`;
}

export function unexpectedCompletionNotePrefix(docusignId: string): string {
  return `UNEXPECTED_COMPLETION ${docusignId}`;
}

export function unexpectedCompletionNote(
  docusignId: string,
  documentLabel: string,
): string {
  return `${unexpectedCompletionNotePrefix(docusignId)}: DocuSign reports this ${documentLabel} envelope signed after it was recalled or replaced. The signed copy was filed separately and the offer was not changed.`;
}

export function unexpectedDeclineNotePrefix(docusignId: string): string {
  return `UNEXPECTED_DECLINE ${docusignId}`;
}

export function unexpectedDeclineNote(
  docusignId: string,
  documentLabel: string,
): string {
  return `${unexpectedDeclineNotePrefix(docusignId)}: DocuSign reports this ${documentLabel} envelope declined after it was recalled or replaced. The offer was not changed.`;
}

// Where an executed PDF is stored. An unexpected completion goes under its own
// folder so it can never be mistaken for, or overwrite, a parent's document.
export function executedPdfPathname(
  prefix: ExecutedDocumentPrefix,
  docusignId: string,
  options?: { readonly unexpected?: boolean },
): string {
  const folder = options?.unexpected ? "offer-signed/unexpected" : "offer-signed";
  return `${folder}/${prefix}-${docusignId}.pdf`;
}

// Whether the parent's executed PDF is this envelope's. The old guard asked only
// whether a URL existed, so after a re-send the parent kept the first
// envelope's PDF and the second signature was never filed.
export function isArchivedForEnvelope(
  url: string | null | undefined,
  prefix: ExecutedDocumentPrefix,
  docusignId: string,
): boolean {
  if (!url) {
    return false;
  }
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return pathname.endsWith(`/${prefix}-${docusignId}.pdf`);
}
