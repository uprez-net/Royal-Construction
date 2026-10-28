"use client";

import {
  checkOfferLists,
  draftHighlightsForOffer,
} from "@/lib/data/offer-inclusion-check";
import { getOfferDocumentExclusions } from "@/lib/offer/workspace-print-template";
import type { ConsistencyFinding } from "@/lib/offer/inclusion-consistency-ai";
import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  defaultOfferValidUntil,
  applyTaskMappingToCostLine,
  collectOwnerIssues,
  createOfferScopeItem,
  removeOfferScopeItem,
  updateOfferScopeItems,
  type OfferDocumentDraft,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
  type OfferWorkspaceStatus,
  getIncludedOfferTenderLineItems,
} from "@/lib/offer/workspace-model";
import {
  INITIAL_PAYMENT_SCHEDULE,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_AREA_CALCULATOR,
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
  reconcileTileOverrides,
  withoutTileOverrides,
  type OfferAreaCalculator,
} from "@/lib/offer/workspace-area";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import {
  calculateDirectTotal,
  calculateEffectiveMargin,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  resolveOptionalPriceInput,
  resolveTargetMarkupPct,
  withDerivedHbcfPremium,
  withDerivedTotalContractValue,
  type OfferWorkspacePricingSettings,
  type RateCardProduct,
  type RateCardTier,
} from "@/lib/offer/workspace-pricing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfferStatus } from "@prisma/client";
import {
  loadActiveOfferWorkspace,
  pollOfferSigningStatus,
  saveOfferWorkspace,
  transitionOfferStatus,
  recallOfferEnvelope,
  createOfferRevision,
} from "@/lib/data/offer-workspace";
import { sendOfferDocument } from "@/lib/data/offer-send";
import { sendTenderForSignature } from "@/lib/data/offer-tender-sign";
import { sendOfferForSignature } from "@/lib/data/offer-accept-sign";
import {
  sendContractForSignature,
  saveContractParticulars,
} from "@/lib/data/offer-contract-sign";
import {
  deriveContractParticularDefaults,
  EMPTY_CONTRACT_PARTICULARS,
  reconcileContractParticularDefaults,
  type ContractParticularKey,
  type ContractParticulars,
} from "@/lib/offer/contract-particulars";
import {
  createProjectFromOffer,
  type ProjectHandoffResult,
} from "@/lib/data/offer-project-handoff";
import {
  generateOfferPrefillFromLead,
  type OfferPrefillResult,
} from "@/lib/data/offer-prefill";
import {
  reevaluateFormulaCostLinesForStatus,
  resolveAreaRateConstants,
  type AdminOfferPrefill,
} from "@/lib/offer/admin-offer-prefill";
import type { RateConstantKey } from "@/lib/offer/formula-variables";
import type {
  OfferWorkspaceSnapshot,
  TenderGateState,
} from "@/lib/offer/workspace-persistence";
import { INITIAL_TENDER_GATE } from "@/lib/offer/workspace-persistence";
import {
  CURRENT_CALC_VERSION,
  isSupportedCalcVersion,
} from "@/lib/offer/calc-version";
import type { OfferSignerStatus } from "@/lib/offer/signing-status";
import type { ContractPreviewTerms } from "@/lib/offer/contract-terms";
import { hasContractTerms } from "@/lib/offer/contract-terms-status";
import {
  lifecycleActionFor,
  type LifecycleAction,
} from "@/lib/offer/lifecycle-busy";
import {
  isUnsafeToLeave,
  type OfferSaveState,
} from "@/lib/offer/workspace-save-state";
import {
  collectOfferSendBlockers,
  describeOfferExpiry,
} from "@/lib/offer/offer-readiness";
import {
  buildIncludesGrannyFlat,
  withoutGrannyOutOfScopeLines,
} from "@/lib/offer/granny-exclusion";
import {
  EMPTY_OFFER_IMAGES,
  setOfferImage,
  type OfferImage,
  type OfferImageMap,
  type OfferImageSlotKey,
} from "@/lib/offer/workspace-images";
import { OfferWorkspacePrintTemplate } from "./offer-workspace-print-template";
import {
  canCreateRevision,
  isOfferBuildStepEditable,
  isWorkspaceSaveStatus,
} from "@/lib/offer/offer-editability";
import {
  OfferWorkspaceScreen,
  type OfferPendingConfirm,
} from "./offer-workspace-screen";

function contractDefaultsFromWorkspace(
  job: OfferWorkspaceJob,
  settings: OfferWorkspacePricingSettings,
): ContractParticulars {
  return deriveContractParticularDefaults({
    currentLocation: job.currentLocation,
    ownerPhone: job.clientPhone,
    hbcfPremium: settings.homeWarrantyHbcfFixed,
  });
}

// How often to re-check signing progress while an envelope is out for signature.
// The DocuSign Connect webhook drives the truth; this only decides how quickly an
// open tab reflects it. 8s is responsive without hammering the server.
const SIGNING_POLL_INTERVAL_MS = 8000;

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
function jobHasEnteredIdentity(job: OfferWorkspaceJob): boolean {
  const ownerEntered = job.owners.some(
    (owner) =>
      // Structural choices count as "entered" too, not just typed text: switching
      // a pristine owner to a company, or adding a second signatory/director,
      // configures the party set and must not be wiped by a late prefill (codex
      // #3). A pristine owner is one blank individual with exactly one signatory.
      owner.kind === "company" ||
      owner.signatories.length !== 1 ||
      owner.displayName.trim().length > 0 ||
      owner.abn.trim().length > 0 ||
      owner.currentLocation.trim().length > 0 ||
      owner.signatories.some(
        (signatory) =>
          signatory.name.trim().length > 0 ||
          signatory.email.trim().length > 0 ||
          signatory.phone.trim().length > 0,
      ),
  );
  return (
    ownerEntered ||
    job.owners.length > 1 ||
    job.siteAddress.trim().length > 0 ||
    job.siteCouncil.trim().length > 0 ||
    job.siteState.trim().length > 0 ||
    job.sitePostcode.trim().length > 0
  );
}

// Apply a lead-prefill patch without destroying identity already entered: a
// pristine offer takes the full patch; a populated one keeps its owner/address
// identity and only refreshes non-identity fields (build type, scope, façade).
function applyPrefillPatch(
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

// Embed with a leadId to persist to the DB (ADR 0002). The standalone
// /offers/new-workflow demo route passes none and stays in-memory.
export function NewOfferWorkspace({
  leadId,
  adminPrefill,
}: {
  readonly leadId?: number;
  readonly adminPrefill?: AdminOfferPrefill;
}) {
  // Lazy-seed validUntil to now + 30 days (same calendar day on the server pass
  // and hydration, so it matches) so a brand-new offer is never born expired.
  const [job, setJob] = useState<OfferWorkspaceJob>(() => ({
    ...INITIAL_OFFER_JOB,
    validUntil: defaultOfferValidUntil(),
    ...(adminPrefill?.buildScope.length
      ? { buildScope: adminPrefill.buildScope }
      : {}),
  }));
  const [lines, setLines] = useState<readonly OfferWorkspaceCostLine[]>(
    adminPrefill?.costLines ?? INITIAL_COST_LINES,
  );
  const [allowances, setAllowances] = useState<
    readonly OfferWorkspaceScopeItem[]
  >(adminPrefill?.allowances ?? INITIAL_ALLOWANCES);
  const [exclusions, setExclusions] = useState<
    readonly OfferWorkspaceScopeItem[]
  >(adminPrefill?.exclusions ?? INITIAL_EXCLUSIONS);
  const [draft, setDraft] = useState<OfferDocumentDraft>(
    adminPrefill?.draft ?? INITIAL_OFFER_DRAFT,
  );
  const rateConstantsRef = useRef<Partial<Record<RateConstantKey, number>>>(
    adminPrefill?.rateConstants ?? {},
  );
  const [overrideReason, setOverrideReason] = useState("");
  const [selectedPriceInput, setSelectedPriceInput] = useState("");
  const [standardPriceInput, setStandardPriceInput] = useState("");
  const [priceAdjustmentLabel, setPriceAdjustmentLabel] = useState("");
  const [status, setStatus] = useState<OfferWorkspaceStatus>("pending");
  // Flips once the server has told us what this offer actually is. The screen
  // seeds "pending" until then, so anything derived from status at first render
  // (which step to open on) is a guess that has to be corrected exactly once.
  const [hydrated, setHydrated] = useState(false);
  const [areaCalculator, setAreaCalculator] = useState<OfferAreaCalculator>(
    adminPrefill?.areaCalculator ?? INITIAL_AREA_CALCULATOR,
  );
  // What the estimator has set. The settings in force are derived from these
  // below, once the cost lines are known (Total Contract Value follows them).
  const [pricingSettingsInput, setPricingSettingsInput] =
    useState<OfferWorkspacePricingSettings>({
      ...DEFAULT_WORKSPACE_PRICING_SETTINGS,
      loadingChargePercentage: adminPrefill?.loadingChargePercentage ?? 0,
    });
  const [importResult, setImportResult] =
    useState<OfferWorkbookImportResult | null>(null);
  const [rateCardProduct, setRateCardProduct] =
    useState<RateCardProduct>("DOUBLE_STOREY");
  const [rateCardTier, setRateCardTier] = useState<RateCardTier>("MID");
  const [paymentSchedule, setPaymentSchedule] = useState<
    readonly OfferPaymentScheduleRow[]
  >(INITIAL_PAYMENT_SCHEDULE);
  const [images, setImages] = useState<OfferImageMap>(EMPTY_OFFER_IMAGES);
  const [tenderGate, setTenderGate] =
    useState<TenderGateState>(INITIAL_TENDER_GATE);
  // The AdminOfferContent version this workspace's admin-derived content came
  // from, persisted in the snapshot. A brand-new offer is seeded from the live
  // prefill the page passed in; a saved offer takes whatever the loader hands
  // back (which the server already refreshed if the offer was editable).
  const [adminContentVersion, setAdminContentVersion] = useState(
    adminPrefill?.adminVersion ?? 0,
  );
  // The calculation rules this offer prices under. A fresh offer seeds at the
  // current version; a saved offer overwrites this from its stored pin in
  // hydrateSnapshot. The SERVER stamp is authoritative — this seed only matters
  // for the window before the first save.
  const [calcVersion, setCalcVersion] = useState<number>(CURRENT_CALC_VERSION);
  // Admin content changed after this offer was frozen (agreed/sent), so the
  // server left the snapshot alone. Surfaced as an advisory send blocker.
  const [adminContentStale, setAdminContentStale] = useState(false);
  const [revising, setRevising] = useState(false);
  const [revisionNotice, setRevisionNotice] = useState<string | null>(null);
  // A recall or revision the estimator has clicked but not yet confirmed.
  const [pendingConfirm, setPendingConfirm] =
    useState<OfferPendingConfirm | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<string | null>(null);
  // Offer-acceptance DocuSign send (ADR 0004) — distinct from the email send above.
  const [offerSignSending, setOfferSignSending] = useState(false);
  const [offerSignError, setOfferSignError] = useState<string | null>(null);
  // Surfaced when a lifecycle action (Mark sent/agreed/rejected) can't proceed
  // because the pre-transition save reconciled to another tab or failed — without
  // it the button looked like a silent no-op (codex #4).
  const [transitionError, setTransitionError] = useState<string | null>(null);
  // The status change, recall or revision running, or null. Double-clicking a
  // lifecycle button used to fire its server action twice: the ref blocks
  // re-entry synchronously, and the state drives the screen's busy line and
  // disables every lifecycle button, marking the one that started.
  const [lifecycleBusy, setLifecycleBusy] = useState<LifecycleAction | null>(
    null,
  );
  const transitioningRef = useRef(false);
  // The mount load failed, so there is no offer to show or save.
  const [loadFailed, setLoadFailed] = useState(false);
  // Per-recipient DocuSign status, loaded with the offer and refreshed whenever
  // we reload it. The Connect webhook writes these rows; before #121/#123 the
  // signing tracker ignored them and hard-coded every customer to "awaiting".
  const [signerStatuses, setSignerStatuses] = useState<
    readonly OfferSignerStatus[]
  >([]);
  const [tenderSending, setTenderSending] = useState(false);
  const [tenderSendError, setTenderSendError] = useState<string | null>(null);
  const [contractSending, setContractSending] = useState(false);
  const [contractSendError, setContractSendError] = useState<string | null>(
    null,
  );
  // Estimator's BC4 particulars (issue #98) — captured during the contract draft
  // and sent as locked tabs so the contract routes to the customer first.
  const [contractParticulars, setContractParticulars] =
    useState<ContractParticulars>(EMPTY_CONTRACT_PARTICULARS);
  const [contractParticularOverrides, setContractParticularOverrides] =
    useState<readonly ContractParticularKey[]>([]);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectResult, setProjectResult] =
    useState<ProjectHandoffResult | null>(null);
  // The handed-off project, from the handoff or from the loader after a reload.
  const [projectId, setProjectId] = useState<string | null>(null);
  // What the BC4 carries, from the loader, so the Contract preview shows the
  // signed Tender's terms (or the sent Contract's) rather than this tab's
  // payment schedule.
  const [contractTerms, setContractTerms] =
    useState<ContractPreviewTerms | null>(null);
  const [prefilling, setPrefilling] = useState(false);
  const [checking, setChecking] = useState(false);
  const [draftingHighlights, setDraftingHighlights] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [findings, setFindings] = useState<readonly ConsistencyFinding[]>([]);
  const [checkedClean, setCheckedClean] = useState(false);
  const [prefillResult, setPrefillResult] = useState<OfferPrefillResult | null>(
    null,
  );
  // Autosave chrome: makes the debounced persistence visible and surfaces a
  // failure instead of swallowing it. "idle" until the first save is attempted.
  const [saveState, setSaveState] = useState<OfferSaveState>("idle");
  // Clock for offer-expiry rendering. Lazily seeded (same calendar day on the
  // server pass and hydration, so the chip label matches), then ticked each
  // minute so "expires in N days" stays honest without a reload.
  const [now, setNow] = useState<Date>(() => new Date());
  const manualLineCounterRef = useRef(0);
  const scopeItemCounterRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Re-evaluate formula-mode cost lines whenever the project measurements (job
  // floor areas / area calculator lineal metres & tile area) change. Only
  // touches lines that carry a `formula` string — fixed/none lines are
  // untouched, so manual edits are never clobbered.
  useEffect(() => {
    if (
      leadId === undefined ||
      job.reference === INITIAL_OFFER_JOB.reference ||
      areaCalculator === INITIAL_AREA_CALCULATOR
    ) {
      return;
    }
    // An offer minted by a newer build names rules we do not have. Recomputing
    // it under ours would reprice a quote the customer already holds, so leave
    // its stored lines exactly as they are.
    if (!isSupportedCalcVersion(calcVersion)) {
      return;
    }
    setLines((prev) => {
      if (!prev.some((l) => l.formula)) return prev;
      // Only while the cost schedule is editable: an issued offer's lines are
      // the price the customer was quoted, and admin rates may have moved.
      return reevaluateFormulaCostLinesForStatus(
        status,
        prev,
        rateConstantsRef.current,
        job,
        areaCalculator,
        calcVersion,
      );
    });
  }, [job, areaCalculator, leadId, calcVersion, status]);

  useEffect(() => {
    if (!isUnsafeToLeave(saveState)) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Required for Chrome/Edge/Safari
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveState]);

  function updateImage(key: OfferImageSlotKey, image: OfferImage | null) {
    setImages((current) => setOfferImage(current, key, image));
  }

  // Floor areas live on the job (single source of truth); pricing keys off it.
  const totalAreaSqm = useMemo(
    () => getAreaBasisTotalSqm(offerAreaBasisFromJob(job)),
    [job],
  );
  // Resolve admin rate constants (defaults + overrides) into the typed shape
  // the Area Calculator panel needs. Set once from the admin prefill and never
  // changes during the session.
  const resolvedRateConstants = useMemo(
    () => resolveAreaRateConstants(rateConstantsRef.current),
    [],
  );
  const directTotal = useMemo(() => calculateDirectTotal(lines), [lines]);
  // Total Contract Value is the build-up's own contract value inc GST, not a
  // typed figure, so the HBCF premium priced on it moves with the cost lines
  // and markups. Only while pricing is editable: an issued offer's premium is
  // part of the price the customer was quoted, and stays as stored. Everything
  // downstream — the price, the screen and the saved snapshot — reads this.
  const workspacePricingSettings = useMemo(
    () =>
      isOfferBuildStepEditable("pricing", status)
        ? withDerivedTotalContractValue(pricingSettingsInput, directTotal)
        : pricingSettingsInput,
    [directTotal, pricingSettingsInput, status],
  );
  const contractParticularDefaults = useMemo(
    () => contractDefaultsFromWorkspace(job, workspacePricingSettings),
    [job, workspacePricingSettings],
  );
  const pricing = useMemo(
    () =>
      calculateOfferWorkspacePricing({
        directTotal,
        totalAreaSqm,
        settings: workspacePricingSettings,
      }),
    [directTotal, totalAreaSqm, workspacePricingSettings],
  );
  const selectedPrice = resolveOptionalPriceInput(selectedPriceInput);
  const customerPrice = useMemo(
    () =>
      calculateOfferCustomerPrice({
        computedContractValueIncGst: pricing.contractValueIncGst,
        selectedContractValueIncGst: selectedPrice,
        overrideReason,
      }),
    [overrideReason, pricing, selectedPrice],
  );
  const standardPrice = resolveOptionalPriceInput(standardPriceInput);
  // Margin at the price actually being charged (honours a manual override),
  // so the badge can warn when an override drops below the minimum markup.
  const effectiveMargin = useMemo(
    () =>
      calculateEffectiveMargin({
        costBeforeFee: pricing.costBeforeFee,
        sellingContractValueIncGst: customerPrice.selectedContractValueIncGst,
        gstRate: workspacePricingSettings.gstRate,
        targetFeePct: resolveTargetMarkupPct(workspacePricingSettings),
      }),
    [customerPrice, pricing.costBeforeFee, workspacePricingSettings],
  );

  // Offer validity vs. today, and the enumerated blockers standing between this
  // draft and a send. Both feed the header chip and the Send & negotiate strip.
  const offerExpiry = useMemo(
    () => describeOfferExpiry(job.validUntil, now),
    [job.validUntil, now],
  );
  // Owner completeness (names, Current Location, unique valid signer emails). Any
  // issue must block not just "Send offer" (server-gated) but also "Mark sent"
  // and "Mark agreed" — otherwise an incomplete offer can be locked/frozen and
  // advanced into the legal documents (server transition guards this too).
  const ownerIssues = useMemo(
    () => collectOwnerIssues(job.owners),
    [job.owners],
  );
  const ownersComplete = ownerIssues.length === 0;
  const sendBlockers = useMemo(
    () =>
      collectOfferSendBlockers({
        hasLead: leadId !== undefined,
        hasKnownFloorArea: totalAreaSqm > 0,
        needsOverrideReason: customerPrice.needsOverrideReason,
        expiryState: offerExpiry?.state ?? "none",
        ownerIssues,
        adminContentStale,
      }),
    [
      adminContentStale,
      leadId,
      totalAreaSqm,
      customerPrice.needsOverrideReason,
      offerExpiry,
      ownerIssues,
    ],
  );

  // Derived from the blockers rather than restated, because the two had already
  // drifted: the list gained a block-severity "floor-area" entry and the Send
  // button carried its own hand-written copy of the rule that did not, so the
  // workspace showed "Enter floor areas before sending a proposal" above a Send
  // button that was still enabled. The four block-severity ids — no-lead,
  // override-reason, owner-*, floor-area — are exactly what this used to spell
  // out by hand, so a new one now gates the button by existing.
  const canSend = useMemo(
    () => !sendBlockers.some((blocker) => blocker.severity === "block"),
    [sendBlockers],
  );

  // A build that includes a granny flat must not also say the granny flat is
  // out of scope. The estimator used to have to find and delete that line
  // before any send would go through; it is now removed as soon as the build
  // says there is one. Job setup is editable only while the offer is pending,
  // and Scope and the offer document are editable then too, so this only ever
  // runs on lists the estimator can still change. The documents filter the same
  // lines at build time, which covers a locked offer and the admin defaults.
  function dropGrannyExclusionsFor(nextJob: OfferWorkspaceJob) {
    if (!buildIncludesGrannyFlat(nextJob)) {
      return;
    }
    setExclusions((current) => [
      ...withoutGrannyOutOfScopeLines(true, current, (item) => [
        item.label,
        item.description,
        item.variationRule,
      ]),
    ]);
    setDraft((current) => {
      const bullets = withoutGrannyOutOfScopeLines(
        true,
        current.exclusionBullets,
        (line) => line,
      );
      return bullets.length === current.exclusionBullets.length
        ? current
        : { ...current, exclusionBullets: [...bullets] };
    });
  }

  function updateJob(patch: Partial<OfferWorkspaceJob>) {
    const nextJob = { ...job, ...patch };
    setJob(nextJob);
    dropGrannyExclusionsFor(nextJob);
    // A tile area the estimator typed over gives way once the floor areas or
    // bathrooms it was worked from change.
    setAreaCalculator((current) =>
      reconcileTileOverrides(current, job, nextJob),
    );
    if (status === "contract_draft") {
      setContractParticulars((current) =>
        reconcileContractParticularDefaults(
          current,
          contractDefaultsFromWorkspace(nextJob, workspacePricingSettings),
          contractParticularOverrides,
        ),
      );
    }
  }

  function updateLine(lineId: string, patch: Partial<OfferWorkspaceCostLine>) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line;
        }

        const nextLine = { ...line, ...patch };

        return patch.itemName === undefined
          ? nextLine
          : applyTaskMappingToCostLine(nextLine, patch.itemName);
      }),
    );
  }

  function updateAllowance(
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) {
    setAllowances((current) => updateOfferScopeItems(current, itemId, patch));
  }

  function updateExclusion(
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) {
    setExclusions((current) => updateOfferScopeItems(current, itemId, patch));
  }

  function addAllowance() {
    scopeItemCounterRef.current += 1;
    setAllowances((current) => [
      ...current,
      createOfferScopeItem(
        `allowance-manual-${scopeItemCounterRef.current}`,
        "prime_cost",
      ),
    ]);
  }

  function removeAllowance(itemId: string) {
    setAllowances((current) => removeOfferScopeItem(current, itemId));
  }

  function addExclusion() {
    scopeItemCounterRef.current += 1;
    setExclusions((current) => [
      ...current,
      createOfferScopeItem(
        `exclusion-manual-${scopeItemCounterRef.current}`,
        "exclusion",
      ),
    ]);
  }

  function removeExclusion(itemId: string) {
    setExclusions((current) => removeOfferScopeItem(current, itemId));
  }

  function updateDraft(patch: Partial<OfferDocumentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    // Any edit invalidates the last judgement. Better no result than a stale
    // one that says an offer is consistent when it no longer is.
    setFindings([]);
    setCheckedClean(false);
  }

  // Draft the offer's selling list FROM the contractual schedule. This shortens
  // and groups text the estimator already committed to; it never authors a
  // specification. Replaces, so it is a deliberate act — the confirm below
  // guards a curated list.
  function draftHighlightsFromSchedule() {
    if (leadId === undefined || draftingHighlights) {
      return;
    }
    if (
      draft.inclusionHighlights.length > 0 &&
      !window.confirm(
        `Replace all ${draft.inclusionHighlights.length} selling lines with a fresh draft from the schedule?`,
      )
    ) {
      return;
    }
    setDraftingHighlights(true);
    setCopyError(null);
    void (async () => {
      try {
        const result = await draftHighlightsForOffer({
          leadId,
          scheduled: draft.inclusionSchedule.map((entry) => entry.spec),
        });
        if (!result.ok) {
          setCopyError(result.message);
          return;
        }
        if (result.highlights.length === 0) {
          setCopyError("Nothing to draft from — the schedule is empty.");
          return;
        }
        updateDraft({ inclusionHighlights: [...result.highlights] });
      } catch (error) {
        console.error("[offer] highlight draft failed:", error);
        setCopyError(`Could not draft the list: ${(error as Error).message}`);
      } finally {
        setDraftingHighlights(false);
      }
    })();
  }

  // Audit estimated -> schedule -> offer. The model only judges; writes nothing.
  function checkOfferConsistencyLists() {
    if (leadId === undefined || checking) {
      return;
    }
    setChecking(true);
    setCopyError(null);
    void (async () => {
      try {
        const result = await checkOfferLists({
          leadId,
          estimated: getIncludedOfferTenderLineItems(lines),
          scheduled: draft.inclusionSchedule.map((entry) => entry.spec),
          excluded: getOfferDocumentExclusions(draft),
          offered: draft.inclusionHighlights,
        });
        if (!result.ok) {
          setCopyError(result.message);
          return;
        }
        setFindings(result.findings);
        setCheckedClean(result.findings.length === 0);
      } catch (error) {
        console.error("[offer] consistency check failed:", error);
        setCopyError(`Could not run the check: ${(error as Error).message}`);
      } finally {
        setChecking(false);
      }
    })();
  }

  function updateTenderGate(patch: Partial<TenderGateState>) {
    setTenderGate((current) => ({ ...current, ...patch }));
  }

  function updateContractParticulars(patch: Partial<ContractParticulars>) {
    const changedKeys = Object.keys(patch) as ContractParticularKey[];
    const nextOverrides = [
      ...new Set([
        ...contractParticularOverrides.filter(
          (key) => !changedKeys.includes(key),
        ),
        ...changedKeys.filter((key) => (patch[key] ?? "").trim().length > 0),
      ]),
    ];
    setContractParticularOverrides(nextOverrides);
    setContractParticulars((current) =>
      reconcileContractParticularDefaults(
        { ...current, ...patch },
        contractDefaultsFromWorkspace(job, workspacePricingSettings),
        nextOverrides,
      ),
    );
  }

  function updateAreaCalculator(patch: Partial<OfferAreaCalculator>) {
    // Rates/measurements only — floor areas are owned by Job setup. A tile area
    // patched to undefined goes back to following the calculation.
    const cleared = (
      ["groundFloorTilesSqm", "bathroomTilesSqm"] as const
    ).filter((key) => key in patch && patch[key] === undefined);
    setAreaCalculator((current) =>
      withoutTileOverrides({ ...current, ...patch }, cleared),
    );
  }

  function updateWorkspacePricingSettings(
    patch: Partial<OfferWorkspacePricingSettings>,
  ) {
    const nextSettings = withDerivedHbcfPremium({
      ...workspacePricingSettings,
      ...patch,
    });
    setPricingSettingsInput(nextSettings);
    if (status === "contract_draft") {
      setContractParticulars((current) =>
        reconcileContractParticularDefaults(
          current,
          contractDefaultsFromWorkspace(job, nextSettings),
          contractParticularOverrides,
        ),
      );
    }
  }

  function importWorkbook(result: OfferWorkbookImportResult) {
    setImportResult(result);
    setLines(result.costLines);
    setAreaCalculator(result.areaCalculator);
    // The workbook has no loading-charge cell, so the import parser can only
    // report the default. Keep the admin-configured percentage (and re-derive
    // the premium with it) instead of silently zeroing it on import.
    setPricingSettingsInput((current) => {
      const imported = {
        ...result.workspacePricingSettings,
        loadingChargePercentage:
          adminPrefill?.loadingChargePercentage ??
          current.loadingChargePercentage,
      };
      // Only re-derive when a loading charge actually applies — with none, the
      // workbook's own dollar premium is kept rather than re-grossed from the
      // reverse-filled TCV, which lands a cent off it.
      return (adminPrefill?.loadingChargePercentage ??
        current.loadingChargePercentage > 0)
        ? withDerivedHbcfPremium(imported)
        : imported;
    });
    // Imported floor areas land on the job — the single source of truth.
    setJob((current) => ({
      ...current,
      groundFloorSqm: result.areaBasis.groundFloorSqm,
      firstFloorSqm: result.areaBasis.firstFloorSqm,
      garageSqm: result.areaBasis.garageSqm,
      alfrescoPorchSqm: result.areaBasis.alfrescoSqm,
      porchSqm: result.areaBasis.porchSqm,
      grannyFlatSqm: result.areaBasis.grannyFlatSqm,
      // The toggle travels with the area. Without this a v2 offer could import
      // granny square metres that still reach the slab basis and every printed
      // total while the field itself is hidden — the exact divergence v2 exists
      // to close, only harder to see.
      hasGrannyHome:
        result.areaBasis.grannyFlatSqm > 0 ? true : current.hasGrannyHome,
    }));
    // Imported areas can introduce the granny flat, so the same removal applies.
    if (result.areaBasis.grannyFlatSqm > 0) {
      dropGrannyExclusionsFor({
        ...job,
        grannyFlatSqm: result.areaBasis.grannyFlatSqm,
        hasGrannyHome: true,
      });
    }
  }

  function addLine() {
    manualLineCounterRef.current += 1;

    setLines((current) => [
      ...current,
      {
        id: `manual-${manualLineCounterRef.current}`,
        stageCode: "A",
        itemName: "",
        buildingSequenceTasks: [],
        offerTenderLineItem: "",
        tradeOrVendor: "",
        notesOrSpec: "",
        costExGst: 0,
        includedInContract: true,
      },
    ]);
  }

  function removeLine(lineId: string) {
    setLines((current) => current.filter((line) => line.id !== lineId));
  }

  // Bulk "Include all": flip every workbook line's contract-inclusion on in one
  // state update. Already-included lines keep their identity so React skips them,
  // and per-row exclude via the Included checkbox still works afterwards.
  function includeAllLines() {
    setLines((current) =>
      current.map((line) =>
        line.includedInContract ? line : { ...line, includedInContract: true },
      ),
    );
  }

  // ─── DB persistence (ADR 0002); no-op without a leadId ───
  const snapshot = useMemo<OfferWorkspaceSnapshot>(
    () => ({
      job,
      lines,
      allowances,
      exclusions,
      draft,
      areaCalculator,
      workspacePricingSettings,
      paymentSchedule,
      rateCardProduct,
      rateCardTier,
      overrideReason,
      selectedPriceInput,
      standardPriceInput,
      priceAdjustmentLabel,
      images,
      tenderGate,
      adminContentVersion,
      // LAST, matching serializeWorkspace. The autosave dirty check compares
      // JSON.stringify of this against the loaded snapshot; a different key
      // order would make every offer look dirty on open and save itself.
      calcVersion,
    }),
    [
      adminContentVersion,
      calcVersion,
      job,
      lines,
      allowances,
      exclusions,
      draft,
      areaCalculator,
      workspacePricingSettings,
      paymentSchedule,
      rateCardProduct,
      rateCardTier,
      overrideReason,
      selectedPriceInput,
      standardPriceInput,
      priceAdjustmentLabel,
      images,
      tenderGate,
    ],
  );

  const offerIdRef = useRef<string | null>(null);

  /**
   * Point the workspace at an offer, dropping messages that belonged to the
   * last one.
   *
   * Guarded on the id actually changing, which is what makes this safe to use
   * at every swap site. Three of them reload the offer in order to REPORT on
   * it — a failed status transition, a partial send, a send that threw — and
   * each sets its error immediately before reloading. Clearing unconditionally
   * there would wipe the message the reload exists to explain. Same offer, no
   * clear.
   *
   * Where the id does change, every one of these describes a revision that is
   * no longer on screen while the panel rendering it still is. A revision
   * created after a failed acceptance send left "the offer can only be sent for
   * signature once it has been sent to the client (current status: OFFER_SENT)"
   * sitting under the button of a fresh revision that was at SENT and perfectly
   * sendable — telling the estimator the thing they were about to do was
   * blocked when it was not. The reload replaced the offer's every other
   * field; these were missed.
   *
   * `sentInfo` is here for the same reason the errors are: "Sent
   * RC-Q-2026-023-R1 to ..." is a claim about a document this revision never
   * sent.
   */
  const adoptOffer = useCallback((nextOfferId: string) => {
    if (offerIdRef.current !== nextOfferId) {
      setSendError(null);
      setSentInfo(null);
      setOfferSignError(null);
      setTransitionError(null);
      setTenderSendError(null);
      setContractSendError(null);
      setCopyError(null);
    }
    offerIdRef.current = nextOfferId;
  }, []);
  const stateVersionRef = useRef(0);
  const lastSavedRef = useRef<string | null>(null);
  // Set when a save refused as "locked" reloaded the live copy, cleared by the
  // next save that lands. A second refusal while it is set means the reload did
  // not settle it, so autosave halts rather than reload in a loop.
  const lockedReloadRef = useRef(false);
  const autosaveHaltedRef = useRef(false);
  const proposalSendInFlightRef = useRef(false);
  // Tracks the last-persisted particulars JSON so the contract-draft save effect
  // fires only on a real change (and never re-saves what we just hydrated).
  const lastSavedParticularsRef = useRef<string | null>(null);
  // Latest particulars for event handlers (the send flush) without stale
  // closures; refs must not be written during render, so sync it in an effect.
  const contractParticularSaveRef = useRef({
    particulars: contractParticulars,
    manualOverrides: contractParticularOverrides,
  });
  useEffect(() => {
    contractParticularSaveRef.current = {
      particulars: contractParticulars,
      manualOverrides: contractParticularOverrides,
    };
  }, [contractParticularOverrides, contractParticulars]);
  // Serializes particulars saves so an older, still-in-flight write can never
  // land after a newer one and then be read into the DocuSign envelope. Each run
  // is chained behind the previous and persists the LATEST value (from the ref),
  // so writes are ordered and the last one always wins. The pre-send flush uses
  // the same chain, so it can't be overtaken by a stale debounced save.
  const particularsSaveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const flushContractParticulars = useCallback(
    (
      offerId: string,
    ): Promise<Awaited<ReturnType<typeof saveContractParticulars>>> => {
      const run = particularsSaveChainRef.current
        .catch(() => undefined)
        .then(
          async (): Promise<
            Awaited<ReturnType<typeof saveContractParticulars>>
          > => {
            const pending = contractParticularSaveRef.current;
            const json = JSON.stringify(pending);
            if (json === lastSavedParticularsRef.current) {
              return { ok: true };
            }
            setSaveState("saving");
            try {
              const saved = await saveContractParticulars({
                offerId,
                particulars: pending.particulars,
                manualOverrides: pending.manualOverrides,
              });
              if (saved.ok) {
                lastSavedParticularsRef.current = json;
                setSaveState("saved");
              } else {
                console.error(
                  "[offer] contract particulars save failed:",
                  saved.error,
                );
                setSaveState("error");
              }
              return saved;
            } catch (error) {
              console.error("[offer] contract particulars save failed:", error);
              setSaveState("error");
              return { ok: false, error: (error as Error).message };
            }
          },
        );
      particularsSaveChainRef.current = run;
      return run;
    },
    [],
  );
  const snapshotRef = useRef(snapshot);
  // Keep the "latest snapshot" ref for event handlers; refs must not be
  // written during render, so sync it in an effect.
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const hydrateSnapshot = useCallback(
    (s: OfferWorkspaceSnapshot, status: OfferWorkspaceStatus) => {
      setJob(s.job);
      setLines(
        s.lines.map((line) => {
          const matchingCostLine = adminPrefill?.costLines.find(
            (costLine) => costLine.itemName === line.itemName,
          );

          return {
            ...line,
            formula:
              status === "pending" ? matchingCostLine?.formula : line.formula,
          };
        }),
      );
      setAllowances(s.allowances);
      setExclusions(s.exclusions);
      setDraft(s.draft);
      setAreaCalculator(s.areaCalculator);
      setPricingSettingsInput({
        ...s.workspacePricingSettings,
        loadingChargePercentage:
          status === "pending"
            ? (adminPrefill?.loadingChargePercentage ??
              s.workspacePricingSettings.loadingChargePercentage)
            : s.workspacePricingSettings.loadingChargePercentage,
      });
      setPaymentSchedule(s.paymentSchedule);
      setRateCardProduct(s.rateCardProduct);
      setRateCardTier(s.rateCardTier);
      setOverrideReason(s.overrideReason);
      setSelectedPriceInput(s.selectedPriceInput);
      setStandardPriceInput(s.standardPriceInput);
      setPriceAdjustmentLabel(s.priceAdjustmentLabel);
      setImages(s.images);
      setTenderGate(s.tenderGate);
      setAdminContentVersion(s.adminContentVersion);
      setCalcVersion(s.calcVersion);
    },
    [adminPrefill?.costLines, adminPrefill?.loadingChargePercentage],
  );

  // A reload hands back the job as last saved, whose label can belong to the
  // revision it was forked from. Show the loaded revision's own, as the mount
  // load does.
  const stampRevisionLabel = useCallback(
    (loaded: {
      readonly reference: string;
      readonly revisionNumber: number;
    }) => {
      setJob((current) => ({
        ...current,
        reference: loaded.reference.replace(/-R\d+$/, ""),
        revision: `R${loaded.revisionNumber}`,
      }));
    },
    [],
  );

  // Single-flight workspace autosave (fixes the overlapping-save clobber).
  //
  // Previously each debounced save fired independently with whatever
  // stateVersionRef held at dispatch time. stateVersionRef only advances after a
  // save RESOLVES, so when a save took longer than the 800ms debounce (slow
  // network / cold server), a second edit dispatched a second save with the SAME
  // (now stale) version. The server rejected it as `stale`, and the stale-handler
  // reloaded + hydrated the server copy — discarding the newer edit. Fast
  // successive edits could therefore be silently reverted.
  //
  // Chaining every run behind the previous one (like the contract-particulars
  // save) guarantees only one save is ever in flight, so our OWN edits can never
  // race each other. Each run loops on the LATEST snapshot (from snapshotRef), so
  // an edit made mid-save is persisted on the next iteration rather than dropped.
  // A `stale`/`superseded` result now only ever means a genuine OTHER writer
  // (another tab), which still reconciles to the live copy per ADR 0002.
  type WorkspaceFlushResult = "clean" | "reconciled" | "error";
  const workspaceSaveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const flushWorkspace = useCallback(
    (offerId: string): Promise<WorkspaceFlushResult> => {
      const run = workspaceSaveChainRef.current
        .catch(() => undefined)
        .then(async (): Promise<WorkspaceFlushResult> => {
          if (leadId === undefined) {
            return "clean";
          }
          // The autosave gate, for explicit flushes too. Nothing is editable at
          // any other status and the server refuses the save, so a flush there
          // reloaded the tab and failed the recall or send that asked for it.
          if (!isWorkspaceSaveStatus(statusRef.current)) {
            return "clean";
          }
          // Loop until the persisted state matches the latest snapshot, so edits
          // made while a save is in flight are saved next (never dropped).
          for (;;) {
            const snapshot = snapshotRef.current;
            const currentJson = JSON.stringify(snapshot);
            if (currentJson === lastSavedRef.current) {
              return "clean";
            }
            setSaveState("saving");
            let result: Awaited<ReturnType<typeof saveOfferWorkspace>>;
            try {
              result = await saveOfferWorkspace({
                offerId,
                expectedStateVersion: stateVersionRef.current,
                snapshot,
              });
            } catch (error) {
              console.error("[offer] autosave failed:", error);
              setSaveState("error");
              return "error";
            }
            if (result.ok) {
              stateVersionRef.current = result.stateVersion;
              lastSavedRef.current = currentJson;
              lockedReloadRef.current = false;
              setSaveState("saved");
              continue; // re-check: capture edits made during the save
            }
            if (result.reason === "locked" && lockedReloadRef.current) {
              console.error(
                "[offer] autosave refused again after reloading; autosave stopped",
              );
              autosaveHaltedRef.current = true;
              setSaveState("error");
              return "error";
            }
            if (
              result.reason === "stale" ||
              result.reason === "superseded" ||
              result.reason === "locked"
            ) {
              // A different tab moved on (single-flight rules out our own
              // overlap) — reconcile to the live copy rather than clobber it.
              // "superseded" means another tab forked a new revision; the same
              // reload lands us on the live one. See ADR 0002 (no field merge).
              // "locked" means the offer was issued meanwhile, so this tab's
              // edits to now-frozen steps were refused; the reload shows the
              // offer at its real status.
              if (result.reason === "locked") {
                lockedReloadRef.current = true;
              }
              try {
                const loaded = await loadActiveOfferWorkspace(leadId);
                adoptOffer(loaded.offerId);
                stateVersionRef.current = loaded.stateVersion;
                setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
                setHydrated(true);
                setSignerStatuses(loaded.signerStatuses ?? []);
                setContractTerms(loaded.contractTerms ?? null);
                if (loaded.snapshot) {
                  hydrateSnapshot(
                    loaded.snapshot,
                    loaded.status.toLowerCase() as OfferWorkspaceStatus,
                  );
                  stampRevisionLabel(loaded);
                  lastSavedRef.current = JSON.stringify(loaded.snapshot);
                }
              } catch (error) {
                // The reconciling reload is OUTSIDE the save try above, so an
                // unguarded failure here (network drop mid-reconcile) rejected
                // the chained promise unhandled AND left saveState stuck at
                // "saving" forever, since line-572's "saving" was never cleared
                // (codex PR #124). Report it as a normal save error instead.
                console.error("[offer] reconcile reload failed:", error);
                setSaveState("error");
                return "error";
              }
              // Not "error": nothing is left unsaved, the tab now shows the
              // live copy. It still needs saying, since an edit may be gone.
              setSaveState("reconciled");
              return "reconciled";
            }
            // "invalid": the server refused the snapshot's shape, and saving
            // the same snapshot again would be refused the same way.
            setSaveState("error");
            return "error";
          }
        });
      workspaceSaveChainRef.current = run;
      return run;
    },
    [leadId, hydrateSnapshot, adoptOffer, stampRevisionLabel],
  );

  // Load the active offer for the lead on mount.
  useEffect(() => {
    if (leadId === undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let loaded: Awaited<ReturnType<typeof loadActiveOfferWorkspace>>;
      try {
        loaded = await loadActiveOfferWorkspace(leadId);
      } catch (error) {
        // Previously unguarded: a failed load left offerIdRef null, which
        // silently disables autosave — the estimator keeps editing a workspace
        // that can never persist, and only finds out when the tab is closed.
        // The pane now shows the failure in place of the steps, so nothing can
        // be edited. It is not a failed save: that state offered a Retry with no
        // offer behind it and prompted on the very reload the pane asks for.
        console.error("[offer] failed to load the workspace:", error);
        if (!cancelled) {
          setLoadFailed(true);
        }
        return;
      }
      if (cancelled) {
        return;
      }
      adoptOffer(loaded.offerId);
      stateVersionRef.current = loaded.stateVersion;
      lockedReloadRef.current = false;
      autosaveHaltedRef.current = false;
      setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
      setHydrated(true);
      // The loader already re-applied the current admin defaults if this offer
      // was still editable (hydrateSnapshot below picks them up). It only flags
      // `adminContentStale` when the offer is frozen and was deliberately left
      // untouched — that is the case worth telling the operator about.
      setAdminContentStale(loaded.adminContentStale === true);
      setSignerStatuses(loaded.signerStatuses ?? []);
      setContractTerms(loaded.contractTerms ?? null);
      setProjectId(loaded.projectId ?? null);
      // The customer declined the last envelope — tell the operator why (the
      // reason comes straight from DocuSign) and point them at a new revision.
      if (loaded.declineReason) {
        setRevisionNotice(
          `${loaded.declineReason} — create a new version to revise and re-send.`,
        );
      }
      // Hydrate the saved BC4 particulars (issue #98); a fresh contract has none.
      const loadedParticulars =
        loaded.contractParticulars ?? EMPTY_CONTRACT_PARTICULARS;
      const loadedParticularOverrides =
        loaded.contractParticularOverrides ?? [];
      const hydratedParticulars =
        loaded.status === OfferStatus.CONTRACT_DRAFT && loaded.snapshot
          ? reconcileContractParticularDefaults(
              loadedParticulars,
              contractDefaultsFromWorkspace(
                loaded.snapshot.job,
                loaded.snapshot.workspacePricingSettings,
              ),
              loadedParticularOverrides,
            )
          : loadedParticulars;
      setContractParticulars(hydratedParticulars);
      setContractParticularOverrides(loadedParticularOverrides);
      lastSavedParticularsRef.current = JSON.stringify({
        particulars: loadedParticulars,
        manualOverrides: loadedParticularOverrides,
      });
      // Show the real minted reference/revision, never the seed default.
      const baseReference = loaded.reference.replace(/-R\d+$/, "");
      const revisionLabel = `R${loaded.revisionNumber}`;
      if (loaded.snapshot) {
        hydrateSnapshot(
          loaded.snapshot,
          loaded.status.toLowerCase() as OfferWorkspaceStatus,
        );
        setJob((current) => ({
          ...current,
          reference: baseReference,
          revision: revisionLabel,
        }));
        lastSavedRef.current = JSON.stringify(loaded.snapshot);
      } else {
        // Brand-new offer: sync the reference, then auto pre-fill from the lead
        // so Job setup is not blank/sample data (Phase 0 + Phase 1).
        setJob((current) => ({
          ...current,
          reference: baseReference,
          revision: revisionLabel,
        }));
        lastSavedRef.current = JSON.stringify(snapshotRef.current);
        setPrefilling(true);
        setPrefillResult(null);
        try {
          const result = await generateOfferPrefillFromLead({ leadId });
          if (cancelled) {
            return;
          }
          setPrefillResult(result);
          if (result.ok) {
            if (Object.keys(result.job).length > 0) {
              setJob((current) => applyPrefillPatch(current, result.job));
            }
            if (Object.keys(result.draft).length > 0) {
              setDraft((current) => ({ ...current, ...result.draft }));
            }
          }
        } finally {
          if (!cancelled) {
            setPrefilling(false);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, hydrateSnapshot, adoptOffer]);

  // Every load brings the Contract step's terms. A status reached without one,
  // a signing poll that saw the Tender signed or a lifecycle click, asks once:
  // the preview otherwise sat on "reload the page", and the signing ticks do
  // not re-read the terms.
  useEffect(() => {
    if (
      leadId === undefined ||
      contractTerms !== null ||
      !hasContractTerms(status)
    ) {
      return;
    }
    const offerId = offerIdRef.current;
    if (offerId === null) {
      return;
    }
    let cancelled = false;
    void pollOfferSigningStatus({ offerId, needsContractTerms: true })
      .then((result) => {
        // The same identity check as the signing poll: a revision forked
        // meanwhile must not take this offer's terms.
        if (
          !cancelled &&
          offerIdRef.current === offerId &&
          result.ok &&
          result.contractTerms
        ) {
          setContractTerms(result.contractTerms);
        }
      })
      .catch((error) => {
        // Best effort: the preview says the terms can't be shown, and the send
        // resolves them again itself.
        console.error("[offer] loading the contract terms failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, status, contractTerms]);

  // Live signing updates. While an envelope is out for signature, the DocuSign
  // Connect webhook updates the database in the background, but an already-open
  // tab holds React state that only re-hydrates on a user action — so a signature
  // landed while the screen still showed "Awaiting signature" until a manual
  // refresh (#121/#123 follow-up). Poll a LIGHTWEIGHT action (status + per-signer
  // status only, no snapshot, so it can't clobber local state) while — and only
  // while — the offer is in one of the two "envelope sent" states. Pauses on a
  // hidden tab and stops the moment the phase advances (signed/declined), because
  // that status change re-runs this effect and the cleanup clears the timer.
  useEffect(() => {
    if (leadId === undefined) {
      return;
    }
    if (
      status !== "offer_sent" &&
      status !== "tender_sent" &&
      status !== "contract_sent"
    ) {
      return;
    }
    const offerId = offerIdRef.current;
    if (offerId === null) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleNext = () => {
      if (!cancelled) {
        timer = setTimeout(tick, SIGNING_POLL_INTERVAL_MS);
      }
    };
    const tick = async () => {
      // Don't poll a backgrounded tab; resume on the next tick once it's visible.
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNext();
        return;
      }
      try {
        const result = await pollOfferSigningStatus({ offerId });
        // Drop a response whose offer identity changed underneath us. `cancelled`
        // alone is insufficient: it flips in the effect cleanup, which React
        // defers to commit time — so a user action that forks a new revision
        // (createRevision sets offerIdRef to the new offer synchronously) leaves
        // a window where this response would otherwise write R1's version/signers
        // onto R2. Re-checking the captured offerId closes that race, matching
        // every other reload path in this file (adversarial review).
        if (cancelled || offerIdRef.current !== offerId) {
          return;
        }
        if (result.ok) {
          setSignerStatuses(result.signerStatuses);
          stateVersionRef.current = result.stateVersion;
          const next = result.status.toLowerCase() as OfferWorkspaceStatus;
          if (next !== status) {
            setStatus(next);
            if (result.declineReason) {
              setRevisionNotice(
                `${result.declineReason} — create a new version to revise and re-send.`,
              );
            }
          }
        }
      } catch (error) {
        // Best-effort: a transient poll failure must not stop the live updates or
        // surface an error — the tab still works, we just try again next tick.
        console.error("[offer] signing-status poll failed:", error);
      }
      scheduleNext();
    };

    timer = setTimeout(tick, SIGNING_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [leadId, status]);

  // Debounced autosave with optimistic concurrency, while the offer is editable.
  useEffect(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      return;
    }
    // Keep autosaving through the Tender-draft phase: the payment schedule is
    // edited after AGREED and feeds the Tender, so freezing at AGREED would
    // silently drop those edits on reload. The agreed basis is preserved
    // separately in agreedSnapshot; workspaceState stays live until the Tender
    // envelope is sent.
    if (!isWorkspaceSaveStatus(status)) {
      return; // frozen once the Tender is sent
    }
    // The server kept refusing this snapshot even after a reload (see
    // flushWorkspace). Explicit actions still try; the timer does not.
    if (autosaveHaltedRef.current) {
      return;
    }
    const currentJson = JSON.stringify(snapshot);
    if (currentJson === lastSavedRef.current) {
      return;
    }
    // Debounce, then hand off to the single-flight flush. The flush reads the
    // latest snapshot itself and serializes saves, so overlapping timers can
    // never dispatch competing saves that clobber each other (see flushWorkspace).
    const timer = setTimeout(() => {
      void flushWorkspace(offerId);
    }, 800);
    return () => clearTimeout(timer);
  }, [snapshot, status, leadId, flushWorkspace]);

  // Debounced save of the BC4 particulars (issue #98). Separate from the main
  // autosave, which freezes once the tender is sent — the particulars are edited
  // later, during the contract draft, and persist to their own Contract column.
  useEffect(() => {
    const offerId = offerIdRef.current;
    if (
      leadId === undefined ||
      offerId === null ||
      status !== "contract_draft"
    ) {
      return;
    }
    if (
      JSON.stringify({
        particulars: contractParticulars,
        manualOverrides: contractParticularOverrides,
      }) === lastSavedParticularsRef.current
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void flushContractParticulars(offerId);
    }, 800);
    return () => clearTimeout(timer);
  }, [
    contractParticularOverrides,
    contractParticulars,
    status,
    leadId,
    flushContractParticulars,
  ]);

  // The "Not saved" chip's Retry. Before it, the only way to retry a failed save
  // was to make another edit. It also lifts an autosave halt and allows one more
  // reload on a "locked" refusal, because the estimator asked for this attempt.
  const retrySave = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      return;
    }
    autosaveHaltedRef.current = false;
    lockedReloadRef.current = false;
    // Before the await, not after: the chip otherwise kept saying "Not saved"
    // for the whole retry, so nothing showed the click had registered and the
    // estimator could fire several retries at once.
    setSaveState("saving");
    void (async () => {
      const workspace = await flushWorkspace(offerId);
      const particulars =
        status === "contract_draft"
          ? await flushContractParticulars(offerId)
          : { ok: true as const };
      if (workspace === "clean" && particulars.ok) {
        setSaveState("saved");
      }
    })();
  }, [leadId, status, flushWorkspace, flushContractParticulars]);

  // Persist a lifecycle transition (flushing the latest state first so AGREED
  // freezes the correct snapshot), then update the UI.
  // `recallScope` turns a status step into a genuine recall: the live DocuSign
  // envelope for that document is voided BEFORE the status moves, so an
  // estimator who sees "Draft" can trust that the customer's signing link is
  // dead. Without it these controls only ever flipped our own status while the
  // superseded document stayed signable.
  const transition = useCallback(
    (
      next: OfferWorkspaceStatus,
      recallScope?: "offer" | "tender" | "contract",
    ) => {
      const offerId = offerIdRef.current;
      if (leadId === undefined || offerId === null) {
        return;
      }
      if (transitioningRef.current) {
        return;
      }
      transitioningRef.current = true;
      setLifecycleBusy(lifecycleActionFor(next, recallScope));
      setTransitionError(null);
      void (async () => {
        try {
          // Flush the latest edits through the single-flight saver first, so
          // AGREED freezes the correct snapshot and no in-flight autosave races
          // this transition. If it had to reconcile to another tab's version (or
          // failed to save), abort rather than transition on stale/unsaved state —
          // flushWorkspace has already reloaded the UI to the live copy. Tell the
          // user why nothing happened (codex #4) instead of returning silently.
          const flush = await flushWorkspace(offerId);
          if (flush !== "clean") {
            setTransitionError(
              flush === "reconciled"
                ? "Your view was refreshed with a newer saved version — review it and try again."
                : "Couldn't save your latest changes, so the status wasn't updated. Try again.",
            );
            return;
          }
          if (recallScope) {
            const recalled = await recallOfferEnvelope({
              offerId,
              scope: recallScope,
              toStatus: next.toUpperCase() as OfferStatus,
            });
            // A refused recall (DocuSign did not confirm the void) leaves the
            // status unchanged and comes back as data, because a thrown server
            // message is hidden in production. Rethrow it so the catch below
            // shows why and resyncs. voidWarnings is empty in practice.
            if (!recalled.ok) {
              throw new Error(recalled.error);
            }
            if (recalled.voidWarnings.length > 0) {
              setTransitionError(recalled.voidWarnings.join(" "));
            }
          } else {
            await transitionOfferStatus({
              offerId,
              toStatus: next.toUpperCase() as OfferStatus,
            });
          }
          if (next === "contract_draft") {
            setContractParticulars((current) =>
              reconcileContractParticularDefaults(
                current,
                contractParticularDefaults,
                contractParticularOverrides,
              ),
            );
          }
          // Only advance the UI once the server transition has committed.
          setStatus(next);
        } catch (error) {
          console.error("[offer] status transition failed:", error);
          setTransitionError(
            `Couldn't update the offer status: ${(error as Error).message}`,
          );
          // Resync the UI to the server's actual state instead of the
          // optimistic target.
          try {
            const loaded = await loadActiveOfferWorkspace(leadId);
            adoptOffer(loaded.offerId);
            stateVersionRef.current = loaded.stateVersion;
            setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
            setSignerStatuses(loaded.signerStatuses ?? []);
            setContractTerms(loaded.contractTerms ?? null);
            if (loaded.snapshot) {
              hydrateSnapshot(
                loaded.snapshot,
                loaded.status.toLowerCase() as OfferWorkspaceStatus,
              );
              lastSavedRef.current = JSON.stringify(loaded.snapshot);
            }
          } catch {
            // Reload failed too — leave the UI as-is.
          }
        } finally {
          transitioningRef.current = false;
          setLifecycleBusy(null);
        }
      })();
    },
    [
      adoptOffer,
      contractParticularDefaults,
      contractParticularOverrides,
      leadId,
      hydrateSnapshot,
      flushWorkspace,
    ],
  );

  // Fork a new active revision (supersedes the current one), then reload the
  // fresh revision into the workspace.
  const createRevision = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      return;
    }
    // Shares the transition guard: a revision racing a recall or status change
    // on the same offer is the double-submit this exists to stop.
    if (transitioningRef.current) {
      return;
    }
    transitioningRef.current = true;
    setLifecycleBusy("revision");
    setRevising(true);
    setRevisionNotice(null);
    void (async () => {
      try {
        // Persist pending edits BEFORE forking. createOfferRevision copies the
        // PERSISTED snapshot, so without this an edit still inside the 800ms
        // autosave debounce is missing from the new revision — and the debounced
        // save then lands on the revision we just superseded (PR #124 review).
        // Every other lifecycle action already flushes first; this one didn't.
        const flush = await flushWorkspace(offerId);
        if (flush !== "clean") {
          setRevisionNotice(
            flush === "reconciled"
              ? "Your view was refreshed with a newer saved version — review it and create the revision again."
              : "Couldn't save your latest changes, so no revision was created. Try again.",
          );
          return;
        }
        const result = await createOfferRevision({ offerId });
        if (!result.ok) {
          setRevisionNotice(
            result.reason === "refused"
              ? result.error
              : "This offer is locked — changes need a contract variation, not a new offer revision.",
          );
          return;
        }
        const loaded = await loadActiveOfferWorkspace(leadId);
        adoptOffer(loaded.offerId);
        stateVersionRef.current = loaded.stateVersion;
        lockedReloadRef.current = false;
        autosaveHaltedRef.current = false;
        setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
        setSignerStatuses(loaded.signerStatuses ?? []);
        setContractTerms(loaded.contractTerms ?? null);
        setProjectId(loaded.projectId ?? null);
        // A forked revision starts with no contract — clear any in-memory
        // particulars so they can't be saved onto the new revision's contract.
        const revisionParticulars =
          loaded.contractParticulars ?? EMPTY_CONTRACT_PARTICULARS;
        const revisionParticularOverrides =
          loaded.contractParticularOverrides ?? [];
        setContractParticulars(revisionParticulars);
        setContractParticularOverrides(revisionParticularOverrides);
        lastSavedParticularsRef.current = JSON.stringify({
          particulars: revisionParticulars,
          manualOverrides: revisionParticularOverrides,
        });
        if (loaded.snapshot) {
          hydrateSnapshot(
            loaded.snapshot,
            loaded.status.toLowerCase() as OfferWorkspaceStatus,
          );
          stampRevisionLabel(loaded);
          lastSavedRef.current = JSON.stringify(loaded.snapshot);
        } else {
          lastSavedRef.current = JSON.stringify(snapshotRef.current);
        }
        if (result.voidWarnings.length > 0) {
          setRevisionNotice(result.voidWarnings.join(" "));
        } else if (result.voidedEnvelopes > 0) {
          setRevisionNotice(
            "New revision created — the previous document was recalled from signature.",
          );
        }
      } catch (error) {
        console.error("[offer] create revision failed:", error);
        setRevisionNotice(
          `Failed to create a new revision: ${(error as Error).message}`,
        );
      } finally {
        setRevising(false);
        transitioningRef.current = false;
        setLifecycleBusy(null);
      }
    })();
  }, [leadId, hydrateSnapshot, flushWorkspace, adoptOffer, stampRevisionLabel]);

  // Recall and Create revision void live DocuSign envelopes, which can't be
  // undone, and a revision supersedes the offer. Their buttons acted on the
  // first click; now they only open the confirmation, and this runs whichever
  // action was confirmed.
  const confirmPending = useCallback(() => {
    const confirmed = pendingConfirm;
    setPendingConfirm(null);
    if (confirmed === null) {
      return;
    }
    if (confirmed.kind === "recall") {
      transition(confirmed.next, confirmed.scope);
    } else {
      createRevision();
    }
  }, [pendingConfirm, transition, createRevision]);

  // Email the proposal PDF to the client. Flushes the latest edits first so the
  // generated PDF matches the workspace, then routes through sendOfferDocument.
  const sendOffer = useCallback(
    (recipientEmail: string, secondaryRecipientEmail?: string | null) => {
      const offerId = offerIdRef.current;
      if (leadId === undefined || offerId === null) {
        setSendError("Save the offer against a lead before sending.");
        return;
      }
      // React state does not update synchronously, so the button can dispatch a
      // second click before `sending` disables it. The ref closes that local
      // window; the attempt id closes transport retries on the server.
      if (proposalSendInFlightRef.current) return;
      proposalSendInFlightRef.current = true;
      const sendAttemptId = crypto.randomUUID();
      setSending(true);
      setSendError(null);
      setSentInfo(null);
      void (async () => {
        try {
          // Flush the latest edits through the single-flight saver first, so the
          // emailed PDF matches the workspace. If it couldn't persist (a stale
          // save reconciled to another writer, or a save error), abort — don't
          // email an offer built from an older snapshot (flushWorkspace has
          // already reloaded the UI on a reconcile).
          const flush = await flushWorkspace(offerId);
          if (flush !== "clean") {
            setSendError(
              flush === "reconciled"
                ? "Your view was refreshed with a newer saved version — review it and send again."
                : "Couldn't save your latest changes before sending. Try again.",
            );
            return;
          }
          const result = await sendOfferDocument({
            offerId,
            recipientEmail,
            secondaryRecipientEmail: secondaryRecipientEmail ?? null,
            sendAttemptId,
          });
          if (result.ok) {
            setStatus("sent");
            // Report exactly who the server emailed (every signatory), not just
            // the primary/secondary the dialog passed in.
            setSentInfo(
              `Sent ${result.reference} to ${result.recipients.join(", ")}.`,
            );
          } else {
            setSendError(result.error);
            // A PARTIAL send fails but still commits: the server flips the offer to
            // SENT once anyone received it. Resync the status so the UI doesn't sit
            // at "pending" against an offer that is durably SENT (PR #124 review) —
            // previously only the throw path below resynced.
            try {
              const loaded = await loadActiveOfferWorkspace(leadId);
              adoptOffer(loaded.offerId);
              stateVersionRef.current = loaded.stateVersion;
              setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
              setSignerStatuses(loaded.signerStatuses ?? []);
              setContractTerms(loaded.contractTerms ?? null);
            } catch {
              // Reload failed — leave the UI as-is; the error message still shows.
            }
          }
        } catch (error) {
          // A throw (rather than a returned {ok:false}) used to surface nothing
          // at all — no message, just an unhandled rejection — so report it.
          // Then resync status from the server: the send can commit before it
          // fails, and a stale "pending" would leave the Offer-build steps
          // editable against an offer that is already SENT.
          console.error("[offer] send failed:", error);
          setSendError(`Failed to send the offer: ${(error as Error).message}`);
          try {
            const loaded = await loadActiveOfferWorkspace(leadId);
            adoptOffer(loaded.offerId);
            stateVersionRef.current = loaded.stateVersion;
            setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
            setSignerStatuses(loaded.signerStatuses ?? []);
            setContractTerms(loaded.contractTerms ?? null);
          } catch {
            // Reload failed too — leave the UI as-is.
          }
        } finally {
          proposalSendInFlightRef.current = false;
          setSending(false);
        }
      })();
    },
    [leadId, flushWorkspace, adoptOffer],
  );

  // Send the Offer document for the customer's DocuSign acceptance signature
  // (ADR 0004) — customer-only, moves the offer SENT → OFFER_SENT. Flushes edits
  // first so the signed PDF matches the workspace. Without a leadId (in-memory
  // demo) it is a no-op (transition no-ops without a lead).
  const sendOfferAccept = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      return;
    }
    setOfferSignSending(true);
    setOfferSignError(null);
    void (async () => {
      try {
        const flush = await flushWorkspace(offerId);
        if (flush !== "clean") {
          setOfferSignError(
            flush === "reconciled"
              ? "Your view was refreshed with a newer saved version — review it and send again."
              : "Couldn't save your latest changes before sending. Try again.",
          );
          return;
        }
        const result = await sendOfferForSignature({ offerId });
        if (result.ok) {
          setStatus("offer_sent");
        } else {
          if (result.status === OfferStatus.OFFER_SENT) {
            setStatus("offer_sent");
          }
          setOfferSignError(result.error);
        }
      } catch (error) {
        console.error("[offer] acceptance send failed:", error);
        setOfferSignError(
          `Failed to send the offer for signature: ${(error as Error).message}`,
        );
      } finally {
        setOfferSignSending(false);
      }
    })();
  }, [leadId, flushWorkspace]);

  // Send the Tender as a runtime DocuSign envelope (anchor-tab AutoPlace).
  // Flushes edits first so the generated PDF matches the workspace. Without a
  // leadId (in-memory demo) it just advances the local status.
  const sendTender = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      transition("tender_sent");
      return;
    }
    setTenderSending(true);
    setTenderSendError(null);
    void (async () => {
      try {
        // Flush through the single-flight saver so the generated Tender PDF
        // matches the workspace; abort if it couldn't persist (stale reconcile or
        // save error) rather than send an envelope built from an older snapshot.
        const flush = await flushWorkspace(offerId);
        if (flush !== "clean") {
          setTenderSendError(
            flush === "reconciled"
              ? "Your view was refreshed with a newer saved version — review it and send again."
              : "Couldn't save your latest changes before sending. Try again.",
          );
          return;
        }
        const result = await sendTenderForSignature({ offerId });
        if (result.ok) {
          setStatus("tender_sent");
        } else {
          if (result.status === OfferStatus.TENDER_SENT) {
            setStatus("tender_sent");
          }
          setTenderSendError(result.error);
        }
      } catch (error) {
        console.error("[offer] tender send failed:", error);
        setTenderSendError(
          `Failed to send the tender: ${(error as Error).message}`,
        );
      } finally {
        setTenderSending(false);
      }
    })();
  }, [leadId, transition, flushWorkspace]);

  // Send the MBA BC4 Contract from the DocuSign template, filled from the
  // signed Tender's snapshot. Without a leadId (in-memory demo) it just
  // advances the local status.
  const sendContract = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      transition("contract_sent");
      return;
    }
    setContractSending(true);
    setContractSendError(null);
    void (async () => {
      try {
        // Flush any un-committed particulars first — through the same serialized
        // chain as the debounced saves, so no older in-flight save can overtake
        // this latest value. The send reads particulars from the DB, and once it
        // flips the offer to CONTRACT_SENT saveContractParticulars is rejected,
        // so an un-flushed value would be dropped. Mirrors sendOffer/sendTender.
        const flushed = await flushContractParticulars(offerId);
        if (!flushed.ok) {
          setContractSendError(
            `Couldn't save the contract particulars before sending: ${flushed.error}`,
          );
          setContractSending(false);
          return;
        }
        const result = await sendContractForSignature({ offerId });
        if (result.ok) {
          // The send returns no replacement terms, and the loader effect exits
          // on contractTerms !== null, so without this the preview keeps the
          // pre-send Tender terms until a reload. Cleared so the effect reloads
          // the terms the Contract actually went out with.
          setContractTerms(null);
          setStatus("contract_sent");
        } else {
          if (result.status === OfferStatus.CONTRACT_SENT) {
            setContractTerms(null);
            setStatus("contract_sent");
          }
          setContractSendError(result.error);
        }
      } catch (error) {
        console.error("[offer] contract send failed:", error);
        setContractSendError(
          `Failed to send the contract: ${(error as Error).message}`,
        );
      } finally {
        setContractSending(false);
      }
    })();
  }, [leadId, transition, flushContractParticulars]);

  // Create the Project from the signed Contract: maps the frozen snapshot,
  // creates milestones + tradie bookings, attaches the executed PDFs, and
  // closes the offer to PROJECT. Without a leadId it just flips local status.
  const createProject = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      transition("project");
      return;
    }
    setProjectCreating(true);
    setProjectResult(null);
    void (async () => {
      try {
        const result = await createProjectFromOffer({ offerId });
        setProjectResult(result);
        if (result.ok) {
          setStatus("project");
          setProjectId(result.projectId);
        }
      } catch (error) {
        console.error("[offer] project handoff failed:", error);
        setProjectResult({
          ok: false,
          error: `Failed to create the project: ${(error as Error).message}`,
        });
      } finally {
        setProjectCreating(false);
      }
    })();
  }, [leadId, transition]);

  // Pre-fill the job from the lead's contact + sales conversation (Phase 0
  // deterministic + Phase 1 AI draft). Explicit user action, so the returned
  // patch is applied over current state (the estimator reviews the result).
  const prefillFromLead = useCallback(() => {
    if (leadId === undefined) {
      return;
    }
    setPrefilling(true);
    setPrefillResult(null);
    void (async () => {
      try {
        const result = await generateOfferPrefillFromLead({ leadId });
        setPrefillResult(result);
        if (result.ok) {
          if (Object.keys(result.job).length > 0) {
            setJob((current) => applyPrefillPatch(current, result.job));
          }
          if (Object.keys(result.draft).length > 0) {
            setDraft((current) => ({ ...current, ...result.draft }));
          }
        }
      } catch (error) {
        console.error("[offer] prefill from lead failed:", error);
        setPrefillResult({
          ok: false,
          error: `Failed to pre-fill from the lead: ${(error as Error).message}`,
        });
      } finally {
        setPrefilling(false);
      }
    })();
  }, [leadId]);

  return (
    <>
      <OfferWorkspaceScreen
        allowances={allowances}
        areaCalculator={areaCalculator}
        calcVersion={calcVersion}
        hydrated={hydrated}
        loadFailed={loadFailed}
        lifecycleBusy={lifecycleBusy}
        rateConstants={resolvedRateConstants}
        customerPrice={customerPrice}
        directTotal={directTotal}
        draft={draft}
        exclusions={exclusions}
        images={images}
        importResult={importResult}
        effectiveMargin={effectiveMargin}
        job={job}
        leadId={leadId}
        workspacePricingSettings={workspacePricingSettings}
        lines={lines}
        overrideReason={overrideReason}
        paymentSchedule={paymentSchedule}
        priceAdjustmentLabel={priceAdjustmentLabel}
        pricing={pricing}
        selectedPriceInput={selectedPriceInput}
        standardPrice={standardPrice}
        standardPriceInput={standardPriceInput}
        status={status}
        offerExpiry={offerExpiry}
        saveState={saveState}
        onRetrySave={retrySave}
        sendBlockers={sendBlockers}
        tenderGate={tenderGate}
        onTenderGateChange={updateTenderGate}
        onAddLine={addLine}
        onAllowanceChange={updateAllowance}
        onAddAllowance={addAllowance}
        onRemoveAllowance={removeAllowance}
        onAddExclusion={addExclusion}
        onRemoveExclusion={removeExclusion}
        onAreaChange={updateAreaCalculator}
        onDownloadOffer={() => window.print()}
        onDraftChange={updateDraft}
        onExclusionChange={updateExclusion}
        onImageChange={updateImage}
        onImported={importWorkbook}
        onJobChange={updateJob}
        onDraftHighlights={draftHighlightsFromSchedule}
        draftingHighlights={draftingHighlights}
        onCheckConsistency={checkOfferConsistencyLists}
        checking={checking}
        copyError={copyError}
        findings={findings}
        checkedClean={checkedClean}
        onPrefillFromLead={prefillFromLead}
        canPrefill={leadId !== undefined}
        prefilling={prefilling}
        prefillResult={prefillResult}
        onWorkspacePricingSettingsChange={updateWorkspacePricingSettings}
        onLineChange={updateLine}
        onIncludeAll={includeAllLines}
        onMarkSent={() => transition("sent")}
        canMarkSent={!customerPrice.needsOverrideReason && ownersComplete}
        onMarkAgreed={() => transition("agreed")}
        // Same owner gate as send/mark-sent: the server transition to AGREED
        // rejects an incomplete party set, so don't leave the button actionable.
        canMarkAgreed={ownersComplete}
        onMarkRejected={() => transition("rejected")}
        onCreateRevision={() => setPendingConfirm({ kind: "revision" })}
        // The server's locked statuses, not a hand-kept subset of them.
        canRevise={leadId !== undefined && canCreateRevision(status)}
        pendingConfirm={pendingConfirm}
        onConfirmPending={confirmPending}
        onCancelPending={() => setPendingConfirm(null)}
        revising={revising}
        revisionNotice={revisionNotice}
        revisionExecuted={status === "contract_signed" || status === "project"}
        onSendOffer={sendOffer}
        canSend={canSend}
        sending={sending}
        sendError={sendError}
        sentInfo={sentInfo}
        transitionError={transitionError}
        signerStatuses={signerStatuses}
        contractTerms={contractTerms}
        onSendOfferForSignature={sendOfferAccept}
        offerSignSending={offerSignSending}
        offerSignError={offerSignError}
        onRecallOffer={() =>
          setPendingConfirm({ kind: "recall", scope: "offer", next: "sent" })
        }
        // Dev-only simulate (guarded server-side): the real OFFER_SIGNED comes
        // from the DocuSign completion webhook.
        onMarkOfferSigned={() => transition("offer_signed")}
        onGenerateTender={() => transition("tender_draft")}
        onSendTender={sendTender}
        tenderSending={tenderSending}
        tenderSendError={tenderSendError}
        onRecallTender={() =>
          setPendingConfirm({
            kind: "recall",
            scope: "tender",
            next: "tender_draft",
          })
        }
        onMarkTenderSigned={() => transition("tender_signed")}
        onGenerateContract={() => transition("contract_draft")}
        onSendContract={sendContract}
        contractSending={contractSending}
        contractSendError={contractSendError}
        contractParticulars={contractParticulars}
        onContractParticularsChange={updateContractParticulars}
        onRecallContract={() =>
          setPendingConfirm({
            kind: "recall",
            scope: "contract",
            next: "contract_draft",
          })
        }
        onMarkContractSigned={() => transition("contract_signed")}
        onCreateProject={createProject}
        projectCreating={projectCreating}
        projectResult={projectResult}
        projectId={projectId}
        onOverrideReasonChange={setOverrideReason}
        onPaymentScheduleChange={setPaymentSchedule}
        onPriceAdjustmentLabelChange={setPriceAdjustmentLabel}
        onSelectedPriceInputChange={setSelectedPriceInput}
        onStandardPriceInputChange={setStandardPriceInput}
        onRemoveLine={removeLine}
      />
      <OfferWorkspacePrintTemplate
        allowances={allowances}
        customerPrice={customerPrice}
        draft={draft}
        exclusions={exclusions}
        images={images}
        job={job}
        lines={lines}
        paymentSchedule={paymentSchedule}
        priceAdjustmentLabel={priceAdjustmentLabel}
        standardPriceIncGst={standardPrice}
      />
    </>
  );
}
