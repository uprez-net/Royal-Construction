import type { OfferWorkspaceStatus } from "./workspace-model";
import type { PersistedOfferWorkspaceState } from "./workspace-persistence";

// Which Offer-build step a lock decision is about. These are the five steps of
// the Offer phase, in order; the later Tender/Contract/Handoff phases gate on
// status separately (see lib/offer/workflow → isOfferPhaseUnlocked).
export type OfferBuildStep =
  | "job-setup"
  | "cost-schedule"
  | "pricing"
  | "scope"
  | "offer-document";

// Whether an Offer-build step still accepts edits at a given offer status.
//
// The offer does NOT freeze all at once when it is issued (#117). While it is
// still being negotiated — `pending` or `sent` — the estimator keeps refining
// the CUSTOMER-FACING proposal: the Offer document copy and the Scope shown on
// it. Those edits auto-save over the offer (the workspace autosave and the
// server save both already allow `sent`; the price the client sees updates on
// the next send — that is the negotiation loop).
//
// The internal PRICE INPUTS (Job setup areas, Cost schedule, Pricing) freeze the
// moment the offer is issued (`sent` onward) so the quoted price cannot drift in
// place; changing them after send is a New revision. This keeps the pricing
// model intact: every binding document is generated from a snapshot frozen at
// its own gate (the Contract from the agreed snapshot; the acceptance PDF at
// send), and those gates all sit at or after `offer_sent`, which is fully locked.
//
// Everything freezes once the offer is out for a signature (`offer_sent`),
// accepted (`offer_signed`), agreed, or in any terminal/declined state.
//
// See CONTEXT.md "Offer editing persistence" / "Offer workspace entry" and
// docs/adr/0005.
export function isOfferBuildStepEditable(
  step: OfferBuildStep,
  status: OfferWorkspaceStatus,
): boolean {
  switch (step) {
    case "scope":
    case "offer-document":
      // Customer-facing content stays editable through the `sent` negotiation
      // window.
      return status === "pending" || status === "sent";
    case "job-setup":
    case "cost-schedule":
    case "pricing":
      // Price inputs freeze as soon as the offer is issued.
      return status === "pending";
  }
}

// True once ANY Offer-build step has frozen — i.e. the offer has been issued
// (it left `pending`). Drives the lock banner shown above the steps.
export function isOfferIssued(status: OfferWorkspaceStatus): boolean {
  return status !== "pending";
}

// True while the offer is issued but the customer-facing document + scope are
// still editable (the `sent` negotiation window). The lock banner uses this to
// explain the PARTIAL lock — price frozen, document still editable — rather than
// the full lock that applies once the offer is out for signature / agreed /
// terminal. Kept in terms of the step rule so the two can never disagree.
export function offerDocumentStillEditableWhileIssued(
  status: OfferWorkspaceStatus,
): boolean {
  return (
    isOfferIssued(status) && isOfferBuildStepEditable("offer-document", status)
  );
}

// Statuses a new revision can't be forked from. Once the Tender is signed the
// job is under contract and a change is a contract variation, and a superseded
// revision is history. createOfferRevision refuses the first six on the server
// and never reaches a superseded row (it is no longer the live revision); the
// workspace asks this so its Create revision button agrees with both.
const REVISION_LOCKED_STATUSES: ReadonlySet<OfferWorkspaceStatus> = new Set([
  "tender_signed",
  "contract_draft",
  "contract_sent",
  "contract_declined",
  "contract_signed",
  "project",
  "superseded",
]);

export function canCreateRevision(status: OfferWorkspaceStatus): boolean {
  return !REVISION_LOCKED_STATUSES.has(status);
}

// The statuses at which the workspace snapshot is saved at all. The payment
// schedule is edited after AGREED and the Tender is built from it, so the
// snapshot stays writable until the Tender is sent; the tender access answers
// are recorded in the same window.
const WORKSPACE_SAVE_STATUSES: ReadonlySet<OfferWorkspaceStatus> = new Set([
  "pending",
  "sent",
  "agreed",
  "tender_draft",
]);

export function isWorkspaceSaveStatus(status: OfferWorkspaceStatus): boolean {
  return WORKSPACE_SAVE_STATUSES.has(status);
}

// Which persisted slices each Offer-build step owns. The job's reference and
// revision are left out on purpose: the workspace stamps the live revision's
// label onto the job when it loads, which is not an edit to the priced job.
// paymentSchedule and tenderGate belong to no build step, so they stay writable
// for as long as the snapshot is.
const STEP_SLICES: Readonly<
  Record<OfferBuildStep, readonly (keyof PersistedOfferWorkspaceState)[]>
> = {
  "job-setup": ["job"],
  "cost-schedule": ["costLines", "areaCalculator"],
  pricing: [
    "pricingSettings",
    "legacyPricingSettings",
    "rateCardProduct",
    "rateCardTier",
    "overrideReason",
    "selectedPriceCents",
    "standardPriceCents",
    "priceAdjustmentLabel",
  ],
  scope: ["allowances", "exclusions"],
  "offer-document": ["draft", "images"],
};

/**
 * The frozen parts of the workspace a save would change, by persisted key.
 *
 * The workspace hides a locked step's controls, but the save is a Server Action
 * that writes the client's whole snapshot, so a tab still showing the offer as
 * pending could reprice it after another tab had sent it. The server asks this
 * before writing, and it asks isOfferBuildStepEditable, so the server refuses
 * exactly what the UI locks.
 *
 * Both snapshots must be in the same persisted form; the save compares them
 * settled (see settledWorkspace). Key order is ignored. Returns ["status"] for
 * a status the workspace never saves at.
 */
export function lockedSnapshotChanges(
  status: OfferWorkspaceStatus,
  stored: PersistedOfferWorkspaceState | null,
  incoming: PersistedOfferWorkspaceState,
): readonly string[] {
  if (!WORKSPACE_SAVE_STATUSES.has(status)) {
    return ["status"];
  }
  // Nothing saved yet, or still pending: there is no issued record to protect.
  if (stored === null || status === "pending") {
    return [];
  }

  const changed: string[] = [];
  const steps = Object.keys(STEP_SLICES) as OfferBuildStep[];
  for (const step of steps) {
    if (isOfferBuildStepEditable(step, status)) {
      continue;
    }
    for (const slice of STEP_SLICES[step]) {
      const same =
        slice === "job"
          ? sameJson(withoutJobLabel(stored.job), withoutJobLabel(incoming.job))
          : sameJson(stored[slice], incoming[slice]);
      if (!same) {
        changed.push(slice);
      }
    }
  }
  // Neither is ever edited, and either one moving reprices the offer.
  for (const slice of ["calcVersion", "adminContentVersion"] as const) {
    if (stored[slice] !== incoming[slice]) {
      changed.push(slice);
    }
  }
  return changed;
}

/**
 * The snapshot a save writes: the incoming one, with every slice frozen at this
 * status taken from the stored row instead.
 *
 * A tab holds the frozen parts in whatever form it last hydrated or imported,
 * and that form does not always read back as the same price. A legacy row's
 * dollar HBCF premium, for one, is re-derived from the contract value the tab
 * fills in. Writing the stored row's own slices keeps an issued offer's stored
 * and printed price exactly where it was, whatever the tab sent.
 */
export function keepFrozenSlices(
  status: OfferWorkspaceStatus,
  stored: PersistedOfferWorkspaceState | null,
  incoming: PersistedOfferWorkspaceState,
): PersistedOfferWorkspaceState {
  if (stored === null || status === "pending") {
    return incoming;
  }
  const next: Record<string, unknown> = { ...incoming };
  const steps = Object.keys(STEP_SLICES) as OfferBuildStep[];
  for (const step of steps) {
    if (isOfferBuildStepEditable(step, status)) {
      continue;
    }
    for (const slice of STEP_SLICES[step]) {
      next[slice] =
        slice === "job"
          ? {
              ...stored.job,
              reference: incoming.job.reference,
              revision: incoming.job.revision,
            }
          : stored[slice];
    }
  }
  next.calcVersion = stored.calcVersion;
  next.adminContentVersion = stored.adminContentVersion;
  return next as PersistedOfferWorkspaceState;
}

function withoutJobLabel(
  job: PersistedOfferWorkspaceState["job"],
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...job };
  delete copy.reference;
  delete copy.revision;
  return copy;
}

// Deep equality over what survives JSON, the form the snapshot is stored in.
// Not node:util's isDeepStrictEqual: this module also ships to the browser.
function sameJson(a: unknown, b: unknown): boolean {
  return sameJsonValue(toJsonValue(a), toJsonValue(b));
}

function toJsonValue(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sameJsonValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJsonValue(item, b[index]))
    );
  }
  if (
    a === null ||
    b === null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && sameJsonValue(left[key], right[key]),
    )
  );
}
