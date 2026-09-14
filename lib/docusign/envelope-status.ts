import { EnvelopeStatus } from "@prisma/client";

// Directive-free so the status rules can be unit-tested without loading Prisma's
// client or a "use server" module.

// Monotonic rank for forward-only status: an out-of-order or replayed event
// must never drag a terminal envelope (COMPLETED/DECLINED/VOIDED) backwards.
// A copy of the rank in app/api/docusign/connect/route.ts, which still carries
// its own; keep the two identical until the webhook imports this one.
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
