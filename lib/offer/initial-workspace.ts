import {
  reevaluateFormulaCostLines,
  type AdminOfferPrefill,
} from "@/lib/offer/admin-offer-prefill";
import { CURRENT_CALC_VERSION } from "@/lib/offer/calc-version";
import { INITIAL_AREA_CALCULATOR } from "@/lib/offer/workspace-area";
import { EMPTY_OFFER_IMAGES } from "@/lib/offer/workspace-images";
import {
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  defaultOfferValidUntil,
  type OfferDocumentDraft,
  type OfferWorkspaceJob,
} from "@/lib/offer/workspace-model";
import { INITIAL_PAYMENT_SCHEDULE } from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_TENDER_GATE,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import {
  calculateDirectTotal,
  withDerivedTotalContractValue,
} from "@/lib/offer/workspace-pricing";

// What a brand-new offer starts as, in one place.
//
// The workspace used to assemble this from a dozen useState seeds, so a new
// offer's first contents existed only in a browser: the server created an
// empty row and the first autosave wrote whatever the screen held. Eve could
// not start an offer at all, because there was no starting state anywhere it
// could reach. The screen seeds from here now, and so does
// lib/domain/offers/start.ts.

/**
 * The snapshot a new offer opens with: the admin defaults where there are
 * some, the built-in samples where there are none, valid for 30 days from
 * `now`, priced under the current calculation rules.
 *
 * Total Contract Value is derived, as the screen derives it while pricing is
 * editable, so what is stored is what the screen would have saved.
 */
export function buildInitialOfferWorkspaceSnapshot(
  adminPrefill?: AdminOfferPrefill,
  now: Date = new Date(),
): OfferWorkspaceSnapshot {
  const lines = adminPrefill?.costLines ?? INITIAL_COST_LINES;
  return {
    job: {
      ...INITIAL_OFFER_JOB,
      validUntil: defaultOfferValidUntil(now),
      ...(adminPrefill?.buildScope.length
        ? { buildScope: adminPrefill.buildScope }
        : {}),
    },
    lines,
    allowances: adminPrefill?.allowances ?? INITIAL_ALLOWANCES,
    exclusions: adminPrefill?.exclusions ?? INITIAL_EXCLUSIONS,
    draft: adminPrefill?.draft ?? INITIAL_OFFER_DRAFT,
    areaCalculator: adminPrefill?.areaCalculator ?? INITIAL_AREA_CALCULATOR,
    workspacePricingSettings: withDerivedTotalContractValue(
      {
        ...DEFAULT_WORKSPACE_PRICING_SETTINGS,
        loadingChargePercentage: adminPrefill?.loadingChargePercentage ?? 0,
      },
      calculateDirectTotal(lines),
    ),
    paymentSchedule: INITIAL_PAYMENT_SCHEDULE,
    rateCardProduct: "DOUBLE_STOREY",
    rateCardTier: "MID",
    overrideReason: "",
    selectedPriceInput: "",
    standardPriceInput: "",
    priceAdjustmentLabel: "",
    images: EMPTY_OFFER_IMAGES,
    tenderGate: INITIAL_TENDER_GATE,
    adminContentVersion: adminPrefill?.adminVersion ?? 0,
    // LAST, matching serializeWorkspace.
    calcVersion: CURRENT_CALC_VERSION,
  };
}

// Identity fields carrying estimator-entered owner/address data. The lead only
// ever has individual contacts, so re-running "Pre-fill from lead" over an
// already-populated offer would wipe a company / directors / Current Location.
// A manual prefill preserves these and only refreshes the rest (codex #4).
const PREFILL_IDENTITY_KEYS: readonly (keyof OfferWorkspaceJob)[] = [
  "owners",
  "clientNames",
  "secondaryCustomerName",
  "clientEmail",
  "secondaryCustomerEmail",
  "clientPhone",
  "currentLocation",
  "siteAddress",
  "siteCouncil",
  "siteState",
  "sitePostcode",
];

// True once the estimator has entered any owner/site identity — a brand-new
// (pristine) offer returns false so auto-prefill fills everything. Inspects
// EVERY owner-carried field, not just the first owner's name: an estimator who
// typed only an email, phone, ABN, Current Location, or a director's name before
// the async prefill resolved must not have that work wiped by the full patch
// (codex #4). owners is the source of truth, so its deep scan subsumes the flat
// client* projection; only the site fields live outside it.
export function jobHasEnteredIdentity(job: OfferWorkspaceJob): boolean {
  const ownerEntered = job.owners.some(
    (owner) =>
      // Structural choices count as "entered" too, not just typed text: switching
      // a pristine owner to a company, or adding a second signatory/director,
      // configures the party set and must not be wiped by a late prefill (codex
      // #3). A pristine owner is one blank individual with exactly one signatory.
      owner.kind === "company"
      || owner.signatories.length !== 1
      || owner.displayName.trim().length > 0
      || owner.abn.trim().length > 0
      || owner.currentLocation.trim().length > 0
      || owner.signatories.some(
        (signatory) =>
          signatory.name.trim().length > 0
          || signatory.email.trim().length > 0
          || signatory.phone.trim().length > 0,
      ),
  );
  return (
    ownerEntered
    || job.owners.length > 1
    || job.siteAddress.trim().length > 0
    || job.siteCouncil.trim().length > 0
    || job.siteState.trim().length > 0
    || job.sitePostcode.trim().length > 0
  );
}

// Apply a lead-prefill patch without destroying identity already entered: a
// pristine offer takes the full patch; a populated one keeps its owner/address
// identity and only refreshes non-identity fields (build type, scope, façade).
export function applyPrefillPatch(
  current: OfferWorkspaceJob,
  patch: Partial<OfferWorkspaceJob>,
): OfferWorkspaceJob {
  if (!jobHasEnteredIdentity(current)) {
    return { ...current, ...patch };
  }
  const preserved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!PREFILL_IDENTITY_KEYS.includes(key as keyof OfferWorkspaceJob)) {
      preserved[key] = value;
    }
  }
  return { ...current, ...(preserved as Partial<OfferWorkspaceJob>) };
}

/** A lead prefill applied to a snapshot: the job patch and the draft patch. */
export function applyLeadPrefill(
  snapshot: OfferWorkspaceSnapshot,
  prefill: {
    readonly job: Partial<OfferWorkspaceJob>;
    readonly draft: Partial<OfferDocumentDraft>;
  },
): OfferWorkspaceSnapshot {
  return {
    ...snapshot,
    job:
      Object.keys(prefill.job).length > 0
        ? applyPrefillPatch(snapshot.job, prefill.job)
        : snapshot.job,
    draft:
      Object.keys(prefill.draft).length > 0
        ? { ...snapshot.draft, ...prefill.draft }
        : snapshot.draft,
  };
}

/**
 * Price a starting snapshot's formula cost lines on its own job and area
 * calculator, and re-derive Total Contract Value from the result.
 *
 * The screen does this in an effect as soon as an editable offer opens. An
 * offer started anywhere else has to do it before saving, or the saved schedule
 * and the lead's deal value carry the admin defaults' figures rather than the
 * ones the lead's own job prices to.
 */
export function priceFormulaCostLines(
  snapshot: OfferWorkspaceSnapshot,
  rateConstants: AdminOfferPrefill["rateConstants"],
): OfferWorkspaceSnapshot {
  if (!snapshot.lines.some((line) => line.formula)) {
    return snapshot;
  }
  const lines = reevaluateFormulaCostLines(
    snapshot.lines,
    rateConstants,
    snapshot.job,
    snapshot.areaCalculator,
    snapshot.calcVersion,
  );
  return {
    ...snapshot,
    lines,
    workspacePricingSettings: withDerivedTotalContractValue(
      snapshot.workspacePricingSettings,
      calculateDirectTotal(lines),
    ),
  };
}
