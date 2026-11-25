// Pure, framework-agnostic readiness helpers for the Offer phase: how close an
// offer's validity is to expiring, and the enumerated blockers that stand
// between the current draft and an email to the client. Kept side-effect free so
// it can be unit-tested and reused across the header chip, the Send & negotiate
// readiness strip and the pre-send confirmation.

export type OfferExpiryState = "none" | "valid" | "soon" | "expired";

export type OfferExpiry = {
  readonly state: OfferExpiryState;
  // Whole days from `now` to `validUntil` (negative once expired); null when no
  // valid date is set.
  readonly daysRemaining: number | null;
  // Short human label, e.g. "Expires in 5 days", "Expires today",
  // "Expired 3 days ago", "Valid until 2026-08-01".
  readonly label: string;
};

// Anything within this many days of expiry reads as "expires soon".
const EXPIRY_SOON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

// Parse an HTML date-input value ("YYYY-MM-DD") to a local day, or null.
function parseDateOnly(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const time = new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  return Number.isNaN(time) ? null : time;
}

export function describeOfferExpiry(
  validUntil: string,
  now: Date,
): OfferExpiry {
  const until = parseDateOnly(validUntil);
  if (until === null) {
    return { state: "none", daysRemaining: null, label: "" };
  }

  const daysRemaining = Math.round((until - startOfDay(now)) / MS_PER_DAY);

  if (daysRemaining < 0) {
    const ago = Math.abs(daysRemaining);
    return {
      state: "expired",
      daysRemaining,
      label: ago === 1 ? "Expired yesterday" : `Expired ${ago} days ago`,
    };
  }
  if (daysRemaining === 0) {
    return { state: "soon", daysRemaining, label: "Expires today" };
  }
  if (daysRemaining <= EXPIRY_SOON_DAYS) {
    return {
      state: "soon",
      daysRemaining,
      label:
        daysRemaining === 1
          ? "Expires tomorrow"
          : `Expires in ${daysRemaining} days`,
    };
  }
  return { state: "valid", daysRemaining, label: `Valid until ${validUntil}` };
}

// A blocker maps a missing prerequisite to the workflow step that fixes it, so
// the UI can render a jump link. `severity: "block"` mirrors the hard send guard
// (email is disabled); `severity: "warn"` is advisory (send still allowed).
export type OfferSendBlockerSeverity = "block" | "warn";

export type OfferSendBlocker = {
  readonly id: string;
  readonly label: string;
  // A step section id (e.g. "offer-step-pricing") for scroll-to-fix.
  readonly stepId: string;
  readonly severity: OfferSendBlockerSeverity;
};

export type OfferSendReadinessInput = {
  readonly hasLead: boolean;
  readonly hasKnownFloorArea: boolean;
  readonly needsOverrideReason: boolean;
  readonly expiryState: OfferExpiryState;
  // Owner party problems from collectOwnerIssues (missing owner name / Current
  // Location / signatory email). Block-severity so the offer can't be sent and
  // locked with party data that prints blank on the legal documents (codex #1).
  readonly ownerIssues?: readonly string[];
  // Pump hire / benching / piles switched on but not priceable (no pile type,
  // a missing count or length, an unset admin price). Such an item adds $0, so
  // sending would quote a total that silently leaves it out: block.
  readonly extraCostIssues?: readonly string[];
  // Unresolved findings from the priced -> promised -> sold consistency check.
  // WARN, never block: this is a model judgement on contract text, and a false
  // positive must not stop a live deal going out.
  readonly inclusionFindingCount?: number;
  // Admin offer content changed after this offer was built, and the offer is
  // already frozen (agreed/sent), so its snapshot was deliberately NOT rewritten
  // — see reapplyAdminContentIfStale. WARN only: the frozen copy is the correct
  // one to re-send, and the operator decides whether the change is material
  // enough to warrant a new revision.
  readonly adminContentStale?: boolean;
};

export function collectOfferSendBlockers({
  hasLead,
  hasKnownFloorArea,
  needsOverrideReason,
  expiryState,
  ownerIssues = [],
  extraCostIssues = [],
  inclusionFindingCount = 0,
  adminContentStale = false,
}: OfferSendReadinessInput): readonly OfferSendBlocker[] {
  const blockers: OfferSendBlocker[] = [];

  if (!hasKnownFloorArea) {
    blockers.push({
      id: "floor-area",
      label: "Enter floor areas in Job setup before sending a proposal.",
      stepId: "offer-step-job-setup",
      severity: "block",
    });
  }

  ownerIssues.forEach((issue, index) => {
    blockers.push({
      id: `owner-${index}`,
      label: issue,
      stepId: "offer-step-job-setup",
      severity: "block",
    });
  });

  extraCostIssues.forEach((issue, index) => {
    blockers.push({
      id: `extra-cost-${index}`,
      label: issue,
      stepId: "offer-step-cost-schedule",
      severity: "block",
    });
  });

  if (!hasLead) {
    blockers.push({
      id: "no-lead",
      label: "Save the offer against a lead before sending.",
      stepId: "offer-step-job-setup",
      severity: "block",
    });
  }
  if (needsOverrideReason) {
    blockers.push({
      id: "override-reason",
      label: "Add the commercial reason for the manual price override.",
      stepId: "offer-step-pricing",
      severity: "block",
    });
  }
  // Every client document states how long the price holds, so a blank or past
  // date blocks the send, as the server's own check does (#534).
  if (expiryState === "none") {
    blockers.push({
      id: "validity-missing",
      label:
        "Set a validity date before sending (in Job setup, or in a new revision once the offer has been sent).",
      stepId: "offer-step-job-setup",
      severity: "block",
    });
  }
  if (expiryState === "expired") {
    blockers.push({
      id: "expired",
      label:
        "This offer's validity date has passed — extend it before sending (in Job setup, or in a new revision once the offer has been sent).",
      stepId: "offer-step-job-setup",
      severity: "block",
    });
  }

  if (inclusionFindingCount > 0) {
    blockers.push({
      id: "inclusion-consistency",
      label: `${inclusionFindingCount} inclusion ${inclusionFindingCount === 1 ? "mismatch" : "mismatches"} unresolved — review before sending`,
      stepId: "offer-step-offer-document",
      severity: "warn",
    });
  }

  if (adminContentStale) {
    blockers.push({
      id: "admin-content-stale",
      label:
        "Admin offer content changed after this offer was issued — its saved copy is unchanged; create a new version to pick up the update.",
      stepId: "offer-step-offer-document",
      severity: "warn",
    });
  }

  return blockers;
}
