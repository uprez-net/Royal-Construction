import { EnvelopeStatus } from "@prisma/client";

// Directive-free so the status rules can be unit-tested without loading Prisma's
// client or a "use server" module.

// Monotonic rank for forward-only status: an out-of-order or replayed event
// must never drag a terminal envelope (COMPLETED/DECLINED/VOIDED) backwards.
// The Connect webhook ranks with this one.
export function envelopeStatusRank(status: EnvelopeStatus): number {
  switch (status) {
    case EnvelopeStatus.SENT:
      return 1;
    case EnvelopeStatus.DELIVERED:
      return 2;
    case EnvelopeStatus.COMPLETED:
    case EnvelopeStatus.DECLINED:
    case EnvelopeStatus.VOIDED:
      return 3;
    default:
      return 0;
  }
}

// Every status in which the customer can still sign. DELIVERED is the one that
// was missing: the Connect webhook writes it the moment the customer opens the
// signing link, so a SENT-only query skipped exactly the envelopes a customer
// had looked at, and Recall voided nothing for them.
//
// A mutable array because Prisma's `in` filter rejects a readonly one.
export const LIVE_ENVELOPE_STATUSES: EnvelopeStatus[] = [
  EnvelopeStatus.CREATED,
  EnvelopeStatus.SENT,
  EnvelopeStatus.DELIVERED,
];

export function isLiveEnvelopeStatus(status: EnvelopeStatus): boolean {
  return LIVE_ENVELOPE_STATUSES.includes(status);
}

// What a refused void means, from the status DocuSign reports for the envelope.
// DocuSign voids only an envelope still out for signature, so a refusal can mean
// it already ended and its Connect event never arrived (the webhook URL is fixed
// when the envelope is created). Voided or declined: nobody can sign it. Signed
// or completed: the customer signed, so it must never pass as recalled. Any
// other status, including one we don't know, counts as still out.
export type RefusedVoidReading =
  | { readonly kind: "ended"; readonly status: EnvelopeStatus }
  | { readonly kind: "signed" }
  | { readonly kind: "still-out" };

export function readRefusedVoid(
  docusignStatus: string | null | undefined,
): RefusedVoidReading {
  switch (docusignStatus?.toLowerCase()) {
    case "voided":
      return { kind: "ended", status: EnvelopeStatus.VOIDED };
    case "declined":
      return { kind: "ended", status: EnvelopeStatus.DECLINED };
    case "signed":
    case "completed":
      return { kind: "signed" };
    default:
      return { kind: "still-out" };
  }
}
