"use client";

import type {
  OfferDocumentDraft,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import {
  collectOfferSigners,
  offerSignerLabel,
} from "@/lib/offer/workspace-model";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import type { ContractParticulars } from "@/lib/offer/contract-particulars";
import type {
  OfferAreaCalculator,
  AreaRateConstants,
} from "@/lib/offer/workspace-area";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import type {
  EffectiveMargin,
  OfferCustomerPrice,
  OfferWorkspacePricing,
  OfferWorkspacePricingSettings,
} from "@/lib/offer/workspace-pricing";
import {
  getAreaBasisTotalSqm,
  rawTotalAreaSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { buildOfferImageContext } from "@/lib/offer/offer-image-context";
import type { OfferSignerStatus } from "@/lib/offer/signing-status";
import {
  deriveTenderGateStatus,
  type TenderGateState,
} from "@/lib/offer/workspace-persistence";
import { formatOfferReference } from "./offer-workspace-format";
import { Lock } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AreaCalculatorPanel } from "./offer-workspace-area";
import { CostSchedulePanel } from "./offer-workspace-cost-schedule";
import { OfferDocumentCanvas } from "./offer-document-canvas";
import { OfferCommandBar } from "./shell/offer-command-bar";
import {
  OfferStepRail,
  type OfferStepState,
} from "./shell/offer-step-rail";
import { OfferSummaryStrip } from "./shell/offer-summary-strip";
import {
  buildOfferStepDigests,
  type OfferStepId,
} from "@/lib/offer/step-digests";
import {
  OFFER_WORKFLOW_STEPS,
  currentOfferStepId,
  stepIdForSectionId,
} from "@/lib/offer/workflow-steps";
import { JobSetupPanel } from "./offer-workspace-job";
import { PriceBuildupPanel } from "./offer-workspace-price-buildup";
import { ContractPanel } from "./offer-workspace-contract";
import { ProjectHandoffPanel } from "./offer-workspace-project-handoff";
import { TenderPanel } from "./offer-workspace-tender";
import { PricingDecisionPanel } from "./offer-workspace-pricing-decision";
import { ScopePanel } from "./offer-workspace-scope";
import { OfferWorkspaceImages } from "./offer-workspace-images";
import type {
  OfferImage,
  OfferImageMap,
  OfferImageSlotKey,
} from "@/lib/offer/workspace-images";
import { SendNegotiatePanel } from "./offer-workspace-send-negotiate";
import { TenderGatePanel } from "./offer-workspace-tender-gate";
import { OfferWorkspaceActivity } from "./offer-workspace-activity";
import { buildOfferReview } from "@/lib/offer/offer-review";
import {
  OfferLockBanner,
  OfferPhaseLockNotice,
  OfferStepBody,
} from "./offer-workspace-step-section";
import { isOfferPhaseUnlocked } from "@/lib/offer/workflow";
import {
  isOfferBuildStepEditable,
  isOfferIssued,
  offerDocumentStillEditableWhileIssued,
} from "@/lib/offer/offer-editability";
import type {
  OfferExpiry,
  OfferSendBlocker,
} from "@/lib/offer/offer-readiness";

import type { OfferSaveState } from "@/lib/offer/workspace-save-state";

// Re-exported for the chrome that already imports it from here.
export type { OfferSaveState };

type OfferWorkspaceScreenProps = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  // The offer's calculation rules, threaded down to the area calculator so an
  // issued offer keeps showing the figures it was priced with.
  // A plain number: an offer minted by a newer build carries a version this one
  // cannot price, and the panels screen for that themselves.
  readonly calcVersion: number;
  // True once the server has reported the offer's real status. Until then
  // `status` is the "pending" seed, and the opening step derived from it is a
  // guess that must be corrected exactly once.
  readonly hydrated: boolean;
  readonly areaCalculator: OfferAreaCalculator;
  readonly rateConstants: AreaRateConstants;
  readonly customerPrice: OfferCustomerPrice;
  readonly directTotal: number;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly images: OfferImageMap;
  readonly importResult: OfferWorkbookImportResult | null;
  readonly job: OfferWorkspaceJob;
  readonly leadId?: number;
  readonly workspacePricingSettings: OfferWorkspacePricingSettings;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly overrideReason: string;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly priceAdjustmentLabel: string;
  readonly pricing: OfferWorkspacePricing;
  readonly effectiveMargin: EffectiveMargin;
  readonly selectedPriceInput: string;
  readonly standardPrice: number | null;
  readonly standardPriceInput: string;
  readonly status: OfferWorkspaceStatus;
  readonly offerExpiry: OfferExpiry | null;
  readonly saveState: OfferSaveState;
  // The "Not saved" chip's Retry.
  readonly onRetrySave: () => void;
  readonly sendBlockers: readonly OfferSendBlocker[];
  readonly tenderGate: TenderGateState;
  readonly onTenderGateChange: (patch: Partial<TenderGateState>) => void;
  readonly onAddLine: () => void;
  readonly onAllowanceChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onAddAllowance: () => void;
  readonly onRemoveAllowance: (itemId: string) => void;
  readonly onAddExclusion: () => void;
  readonly onRemoveExclusion: (itemId: string) => void;
  readonly onAreaChange: (patch: Partial<OfferAreaCalculator>) => void;
  readonly onDownloadOffer: () => void;
  readonly onDraftChange: (patch: Partial<OfferDocumentDraft>) => void;
  readonly onDraftHighlights?: () => void;
  readonly onCheckConsistency?: () => void;
  readonly draftingHighlights?: boolean;
  readonly checking?: boolean;
  readonly copyError?: string | null;
  readonly findings?: readonly import("@/lib/offer/inclusion-consistency-ai").ConsistencyFinding[];
  readonly checkedClean?: boolean;
  readonly onImageChange: (
    key: OfferImageSlotKey,
    image: OfferImage | null,
  ) => void;
  readonly onExclusionChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onImported: (result: OfferWorkbookImportResult) => void;
  readonly onJobChange: (patch: Partial<OfferWorkspaceJob>) => void;
  readonly onPrefillFromLead?: () => void;
  readonly canPrefill?: boolean;
  readonly prefilling?: boolean;
  readonly prefillResult?:
    | import("@/lib/data/offer-prefill").OfferPrefillResult
    | null;
  readonly onWorkspacePricingSettingsChange: (
    patch: Partial<OfferWorkspacePricingSettings>,
  ) => void;
  readonly onLineChange: (
    lineId: string,
    patch: Partial<OfferWorkspaceCostLine>,
  ) => void;
  readonly onIncludeAll: () => void;
  readonly onRemoveLine: (lineId: string) => void;
  readonly onMarkSent: () => void;
  readonly canMarkSent: boolean;
  readonly onMarkAgreed: () => void;
  readonly canMarkAgreed: boolean;
  readonly onMarkRejected: () => void;
  readonly onCreateRevision: () => void;
  readonly canRevise: boolean;
  readonly revising: boolean;
  readonly revisionNotice: string | null;
  readonly revisionExecuted: boolean;
  readonly onSendOffer: (email: string, secondaryEmail?: string | null) => void;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly sentInfo: string | null;
  readonly transitionError: string | null;
  // Per-recipient DocuSign status for the signing trackers (#121/#123).
  readonly signerStatuses: readonly OfferSignerStatus[];
  // Offer-document acceptance signing (ADR 0004) — customer-only DocuSign send.
  readonly onSendOfferForSignature: () => void;
  readonly offerSignSending?: boolean;
  readonly offerSignError?: string | null;
  readonly onRecallOffer: () => void;
  readonly onMarkOfferSigned: () => void;
  readonly onGenerateTender: () => void;
  readonly onSendTender: () => void;
  readonly tenderSending?: boolean;
  readonly tenderSendError?: string | null;
  readonly onRecallTender: () => void;
  readonly onMarkTenderSigned: () => void;
  readonly onGenerateContract: () => void;
  readonly onSendContract: () => void;
  readonly contractSending?: boolean;
  readonly contractSendError?: string | null;
  readonly contractParticulars: ContractParticulars;
  readonly onContractParticularsChange: (
    patch: Partial<ContractParticulars>,
  ) => void;
  readonly onRecallContract: () => void;
  readonly onMarkContractSigned: () => void;
  readonly onCreateProject: () => void;
  readonly projectCreating?: boolean;
  readonly projectResult?:
    | import("@/lib/data/offer-project-handoff").ProjectHandoffResult
    | null;
  readonly onOverrideReasonChange: (value: string) => void;
  readonly onPaymentScheduleChange: (
    rows: readonly OfferPaymentScheduleRow[],
  ) => void;
  readonly onPriceAdjustmentLabelChange: (value: string) => void;
  readonly onSelectedPriceInputChange: (value: string) => void;
  readonly onStandardPriceInputChange: (value: string) => void;
};

export function OfferWorkspaceScreen({
  allowances,
  areaCalculator,
  calcVersion,
  hydrated,
  rateConstants,
  customerPrice,
  directTotal,
  draft,
  exclusions,
  images,
  importResult,
  job,
  leadId,
  workspacePricingSettings,
  effectiveMargin,
  lines,
  overrideReason,
  paymentSchedule,
  priceAdjustmentLabel,
  pricing,
  selectedPriceInput,
  standardPriceInput,
  status,
  offerExpiry,
  saveState,
  onRetrySave,
  sendBlockers,
  tenderGate,
  onTenderGateChange,
  onAddLine,
  onAllowanceChange,
  onAddAllowance,
  onRemoveAllowance,
  onAddExclusion,
  onRemoveExclusion,
  onAreaChange,
  onDownloadOffer,
  onDraftChange,
  onDraftHighlights,
  onCheckConsistency,
  draftingHighlights,
  checking,
  copyError,
  findings,
  checkedClean,
  onImageChange,
  onExclusionChange,
  onImported,
  onJobChange,
  onPrefillFromLead,
  canPrefill,
  prefilling,
  prefillResult,
  onWorkspacePricingSettingsChange,
  onLineChange,
  onIncludeAll,
  onRemoveLine,
  onMarkSent,
  canMarkSent,
  onMarkAgreed,
  canMarkAgreed,
  onMarkRejected,
  onCreateRevision,
  canRevise,
  revising,
  revisionNotice,
  revisionExecuted,
  onSendOffer,
  canSend,
  sending,
  sendError,
  sentInfo,
  transitionError,
  signerStatuses,
  onSendOfferForSignature,
  offerSignSending,
  offerSignError,
  onRecallOffer,
  onMarkOfferSigned,
  onGenerateTender,
  onSendTender,
  tenderSending,
  tenderSendError,
  onRecallTender,
  onMarkTenderSigned,
  onGenerateContract,
  onSendContract,
  contractSending,
  contractSendError,
  contractParticulars,
  onContractParticularsChange,
  onRecallContract,
  onMarkContractSigned,
  onCreateProject,
  projectCreating,
  projectResult,
  onOverrideReasonChange,
  onPaymentScheduleChange,
  onPriceAdjustmentLabelChange,
  onSelectedPriceInputChange,
  onStandardPriceInputChange,
}: OfferWorkspaceScreenProps) {
  // Visual finish/façade descriptors per image slot, derived from the offer's
  // included selections — woven into the AI image prompts.
  const imageFinishContexts = useMemo(
    () => buildOfferImageContext({ job, lines, allowances }),
    [job, lines, allowances],
  );
  // Floor areas come from Job setup; the helper and pricing read them here.
  const areaBasis = useMemo(() => offerAreaBasisFromJob(job), [job]);

  // Per-section completeness for the pre-send Review panel.
  const reviewSections = useMemo(
    () =>
      buildOfferReview({
        job,
        lines,
        allowances,
        exclusions,
        draft,
        customerPrice,
      }),
    [job, lines, allowances, exclusions, draft, customerPrice],
  );


  // The Offer-build steps do NOT all freeze at once when the offer is issued
  // (#117). The customer-facing content — the Offer document copy and the Scope
  // shown on it — stays editable through the `sent` negotiation window so the
  // estimator can refine the proposal while negotiating; those edits auto-save.
  // The internal price inputs (Job setup, Cost schedule, Pricing) freeze the
  // moment the offer is issued so the quoted price can't drift in place — a price
  // change after send is a New revision. Everything freezes once the offer is out
  // for signature / agreed / terminal. See lib/offer/offer-editability + ADR 0005.
  const offerIssued = isOfferIssued(status);
  const jobSetupLocked = !isOfferBuildStepEditable("job-setup", status);
  const costScheduleLocked = !isOfferBuildStepEditable("cost-schedule", status);
  const pricingLocked = !isOfferBuildStepEditable("pricing", status);
  const scopeLocked = !isOfferBuildStepEditable("scope", status);
  const offerDocumentLocked = !isOfferBuildStepEditable(
    "offer-document",
    status,
  );
  // In the `sent` window the document + scope are still editable while the price
  // is frozen — the banner explains this partial lock rather than a full one.
  const documentsStillEditable = offerDocumentStillEditableWhileIssued(status);

  // Tender access gate (Step 7). The gate only holds the Tender panel while
  // the offer is at AGREED — once a Tender is generated (tender_draft+) the
  // gate is moot and the panel stays reachable.
  const tenderGateStatus = deriveTenderGateStatus(tenderGate);
  const gateUnlocked = tenderGateStatus === "unlocked";
  const tenderPanelUnlocked =
    isOfferPhaseUnlocked(status, "tender") &&
    (status !== "agreed" || gateUnlocked);

  // Open on the step the offer is actually at, rather than on ten collapsed
  // headers with no "you are here".
  //
  // The lazy initializer runs on first render, when `status` is still the
  // "pending" seed, so every agreed/tender/contract offer used to land on a
  // fully disabled Job setup pane. Correct it exactly once, when the real
  // status arrives — and only once: the DocuSign poll calls setStatus on its own
  // schedule and following it would yank the pane out from under a typing user.
  const [activeStepId, setActiveStepId] = useState<OfferStepId>(() =>
    currentOfferStepId(status, tenderGateStatus),
  );
  const syncedToHydratedStatusRef = useRef(false);
  useEffect(() => {
    if (hydrated && !syncedToHydratedStatusRef.current) {
      syncedToHydratedStatusRef.current = true;
      setActiveStepId(currentOfferStepId(status, tenderGateStatus));
    }
  }, [hydrated, status, tenderGateStatus]);

  // A step change replaces the whole pane. Move focus to it and reset its
  // scroll, but only for changes the user made: a rail click, or a send blocker
  // that selected the step which resolves it (that button unmounts itself in the
  // same commit, which used to drop focus onto <body>). Page load and the
  // hydration correction above must not steal focus.
  const paneRef = useRef<HTMLDivElement>(null);
  const userNavigatedRef = useRef(false);
  const navigateToStep = useCallback((stepId: OfferStepId) => {
    userNavigatedRef.current = true;
    setActiveStepId(stepId);
  }, []);
  useEffect(() => {
    if (!userNavigatedRef.current) {
      return;
    }
    userNavigatedRef.current = false;
    const pane = paneRef.current;
    if (!pane) {
      return;
    }
    pane.scrollTop = 0;
    pane.focus({ preventScroll: true });
  }, [activeStepId]);

  const [railCollapsed, setRailCollapsed] = useState(false);

  // Panel state that must outlive its panel. Only the active step is mounted,
  // so anything a panel kept in local useState was wiped on every step change.
  // The screen stays mounted for the life of the page, so it holds these.
  const [expandedLineIds, setExpandedLineIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleLineExpanded = useCallback((lineId: string) => {
    setExpandedLineIds((previous) => {
      const next = new Set(previous);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  }, []);
  const [aiBusy, setAiBusy] = useState<
    Partial<Record<OfferImageSlotKey, boolean>>
  >({});
  const setAiBusyFor = useCallback(
    (key: OfferImageSlotKey, busy: boolean) =>
      setAiBusy((current) => ({ ...current, [key]: busy })),
    [],
  );
  const activeStepIsOfferPhase =
    OFFER_WORKFLOW_STEPS.find((step) => step.id === activeStepId)?.phase ===
    "offer";

  const phaseUnlocked = useMemo(
    () => ({
      "tender-gate": isOfferPhaseUnlocked(status, "tender"),
      tender: tenderPanelUnlocked,
      contract: isOfferPhaseUnlocked(status, "contract"),
      project: isOfferPhaseUnlocked(status, "handoff"),
    }),
    [status, tenderPanelUnlocked],
  );

  const digests = useMemo(
    () =>
      buildOfferStepDigests({
        phaseUnlocked,
        job,
        // rawTotalAreaSqm, not getAreaBasisTotalSqm: this is a DISPLAYED area and
        // must agree with the Job setup card and the printed documents. The
        // rounded variant stays on the pricing path (PriceBuildupPanel below).
        totalAreaSqm: rawTotalAreaSqm(areaBasis),
        lines,
        directTotal,
        contractValueIncGst: customerPrice.selectedContractValueIncGst,
        effectiveMargin,
        allowances,
        exclusions,
        images,
        status,
        sendBlockers,
      }),
    [
      job,
      areaBasis,
      lines,
      directTotal,
      customerPrice.selectedContractValueIncGst,
      effectiveMargin,
      allowances,
      exclusions,
      images,
      status,
      sendBlockers,
      phaseUnlocked,
    ],
  );

  // Rail state per step. The Offer steps report completeness from the review the
  // page already computes; the later phases report whether their gate is open.
  const stepStates = useMemo(() => {
    const complete = new Set(
      reviewSections
        .filter((section) => section.status === "complete")
        .map((section) => section.stepId),
    );
    // A gated phase is complete once the offer has moved past it, not merely
    // once it has opened — and never complete while still shut.
    const currentIndex = OFFER_WORKFLOW_STEPS.findIndex(
      (step) => step.id === currentOfferStepId(status, tenderGateStatus),
    );
    const states = {} as Record<OfferStepId, OfferStepState>;
    for (const step of OFFER_WORKFLOW_STEPS) {
      if (step.id in phaseUnlocked) {
        const unlocked = phaseUnlocked[step.id as keyof typeof phaseUnlocked];
        states[step.id] = !unlocked
          ? "locked"
          : OFFER_WORKFLOW_STEPS.indexOf(step) < currentIndex
            ? "complete"
            : "incomplete";
      } else if (step.id === "send") {
        // Rejected, superseded and declined are outcomes, not completion; the
        // old page reserved the tick for an accepted or agreed offer.
        states[step.id] = SEND_COMPLETE_STATUSES.has(status)
          ? "complete"
          : "incomplete";
      } else {
        states[step.id] = complete.has(step.sectionId)
          ? "complete"
          : "incomplete";
      }
    }
    return states;
  }, [reviewSections, status, tenderGateStatus, phaseUnlocked]);

  return (
    // One app-height frame: the command bar and the summary strip are fixed
    // rows, the rail and the pane share what is left, and only the pane
    // scrolls. Nothing here scrolls the window, so the old measured
    // `--offer-sticky-offset` and every `scroll-mt-*` guess are gone.
    <div
      className="flex h-[calc(100dvh-7.5rem)] min-h-125 flex-col overflow-hidden rounded-lg border border-border/70 bg-background shadow-sm print:hidden"
      aria-labelledby="new-offer-workspace-title"
    >
      <OfferCommandBar
        customerPrice={customerPrice}
        job={job}
        leadId={leadId}
        status={status}
        offerExpiry={offerExpiry}
        saveState={saveState}
        onDownloadPreview={onDownloadOffer}
        onRetrySave={onRetrySave}
      />
      <div className="flex min-h-0 flex-1">
        <OfferStepRail
          activeStepId={activeStepId}
          collapsed={railCollapsed}
          digests={digests}
          stepStates={stepStates}
          onSelect={navigateToStep}
          onToggleCollapsed={() => setRailCollapsed((current) => !current)}
        />
        {/* Not <main>: the app shell already provides the page's single main
            landmark, and nesting one inside another is invalid and gives screen
            readers two "main" regions to choose between. */}
        <div
          ref={paneRef}
          role="region"
          aria-labelledby="offer-pane-title"
          tabIndex={-1}
          className="@container/pane min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-5 outline-none"
        >
          <div className="space-y-5">
          {/* The banner names the offer-build steps; it has no business above
              Tender, Contract or Project. */}
          {offerIssued && activeStepIsOfferPhase ? (
            <OfferLockBanner
              canRevise={canRevise}
              revising={revising}
              executed={revisionExecuted}
              documentsEditable={documentsStillEditable}
              notice={revisionNotice}
              onCreateRevision={onCreateRevision}
            />
          ) : null}
          <StepPane
            active={activeStepId === "job-setup"}
            locked={jobSetupLocked}
            title="Job setup"
          >
            <JobSetupPanel
              calcVersion={calcVersion}
              job={job}
              onJobChange={onJobChange}
              onPrefillFromLead={onPrefillFromLead}
              canPrefill={canPrefill}
              prefilling={prefilling}
              prefillResult={prefillResult}
            />
          </StepPane>

          <StepPane
            active={activeStepId === "cost-schedule"}
            locked={costScheduleLocked}
            title="Cost schedule"
          >
            <AreaCalculatorPanel
              calcVersion={calcVersion}
              job={job}
              basis={areaBasis}
              area={areaCalculator}
              rateConstants={rateConstants}
              onAreaChange={onAreaChange}
              onJobChange={onJobChange}
            />
            <CostSchedulePanel
              expandedLineIds={expandedLineIds}
              onToggleLineExpanded={toggleLineExpanded}
              importResult={importResult}
              lines={lines}
              onAddLine={onAddLine}
              onImported={onImported}
              onLineChange={onLineChange}
              onIncludeAll={onIncludeAll}
              onRemoveLine={onRemoveLine}
            />
          </StepPane>

          <StepPane
            active={activeStepId === "pricing"}
            locked={pricingLocked}
            title="Pricing"
          >
            <PriceBuildupPanel
              directTotal={directTotal}
              settings={workspacePricingSettings}
              pricing={pricing}
              totalAreaSqm={getAreaBasisTotalSqm(areaBasis)}
              onSettingsChange={onWorkspacePricingSettingsChange}
            />
            <PricingDecisionPanel
              customerPrice={customerPrice}
              overrideReason={overrideReason}
              priceAdjustmentLabel={priceAdjustmentLabel}
              selectedPriceInput={selectedPriceInput}
              standardPriceInput={standardPriceInput}
              onOverrideReasonChange={onOverrideReasonChange}
              onPriceAdjustmentLabelChange={onPriceAdjustmentLabelChange}
              onSelectedPriceInputChange={onSelectedPriceInputChange}
              onStandardPriceInputChange={onStandardPriceInputChange}
            />
          </StepPane>

          <StepPane
            active={activeStepId === "scope"}
            locked={scopeLocked}
            title="Scope"
          >
            <ScopePanel
              allowances={allowances}
              exclusions={exclusions}
              onAllowanceChange={onAllowanceChange}
              onExclusionChange={onExclusionChange}
              onAddAllowance={onAddAllowance}
              onRemoveAllowance={onRemoveAllowance}
              onAddExclusion={onAddExclusion}
              onRemoveExclusion={onRemoveExclusion}
            />
          </StepPane>

          <StepPane
            active={activeStepId === "offer-document"}
            locked={offerDocumentLocked}
            title="Offer document"
          >
            <div className="space-y-6">
              <OfferDocumentCanvas
                customerPrice={customerPrice}
                draft={draft}
                exclusions={exclusions}
                job={job}
                onDraftChange={onDraftChange}
                onDraftHighlights={onDraftHighlights}
                onCheckConsistency={onCheckConsistency}
                draftingHighlights={draftingHighlights}
                checking={checking}
                copyError={copyError}
                findings={findings}
                checkedClean={checkedClean}
              />
              <OfferWorkspaceImages
                aiBusy={aiBusy}
                onAiBusyChange={setAiBusyFor}
                images={images}
                onImageChange={onImageChange}
                leadId={leadId}
                buildType={job.buildType}
                finishContexts={imageFinishContexts}
              />
            </div>
          </StepPane>

          <StepPane
            active={activeStepId === "send"}
            locked={false}
            title="Send & negotiate"
          >
            <SendNegotiatePanel
              // A blocker names the step that fixes it; selecting that step is
              // the new equivalent of the old scroll-to-section.
              onNavigateToStep={(sectionId) => {
                const target = stepIdForSectionId(sectionId);
                if (target) {
                  navigateToStep(target);
                }
              }}
              status={status}
              canRevise={canRevise}
              revising={revising}
              // Recipients = every customer signatory (individual owners + company
              // directors), the SAME set sendOfferDocument emails server-side.
              // Shown read-only so the confirmed list can't diverge from where the
              // proposal actually goes (PR #124 review); edit emails in Job setup.
              recipients={collectOfferSigners(job.owners).map((signer) => ({
                email: signer.signatory.email.trim(),
                label: offerSignerLabel(signer),
              }))}
              contractValueIncGst={customerPrice.selectedContractValueIncGst}
              offerReference={formatOfferReference(job.reference, job.revision)}
              sendBlockers={sendBlockers}
              canSend={canSend}
              sending={sending}
              sendError={sendError}
              sentInfo={sentInfo}
              transitionError={transitionError}
              canMarkSent={canMarkSent}
              onSendOffer={onSendOffer}
              onMarkSent={onMarkSent}
              onCreateRevision={onCreateRevision}
              onMarkAgreed={onMarkAgreed}
              canMarkAgreed={canMarkAgreed}
              onMarkRejected={onMarkRejected}
              // Offer-acceptance DocuSign signing (ADR 0004). The recipient set is
              // the same customer signatories already shown above.
              signerStatuses={signerStatuses}
              onSendForSignature={onSendOfferForSignature}
              offerSignSending={offerSignSending}
              offerSignError={offerSignError}
              onRecallOffer={onRecallOffer}
              onMarkOfferSigned={onMarkOfferSigned}
            />
            <OfferWorkspaceActivity leadId={leadId} status={status} />
          </StepPane>

          <StepPane
            active={activeStepId === "tender-gate"}
            unlocked={isOfferPhaseUnlocked(status, "tender")}
            unlockHint={"Unlocks once the Offer is agreed. Decide whether tender access unlocks immediately or is held pending an architectural-plan fee and upload."}
            title="Tender access"
          >
            <TenderGatePanel
              status={status}
              tenderGate={tenderGate}
              leadId={leadId}
              onTenderGateChange={onTenderGateChange}
              onCreateRevision={onCreateRevision}
              canRevise={canRevise}
              revising={revising}
            />
          </StepPane>

          <StepPane
            active={activeStepId === "tender"}
            unlocked={tenderPanelUnlocked}
            unlockHint={
              gateUnlocked
                ? "Unlocks once the Offer is agreed. Decide the payment schedule, generate the Tender, and send it for signature via DocuSign."
                : "Complete the Tender access step to unlock the Tender."
            }
            title="Tender"
          >
            <TenderPanel
              signerStatuses={signerStatuses}
              customerPrice={customerPrice}
              draft={draft}
              exclusions={exclusions}
              job={job}
              paymentSchedule={paymentSchedule}
              status={status}
              onGenerateTender={onGenerateTender}
              onMarkTenderSigned={onMarkTenderSigned}
              onPaymentScheduleChange={onPaymentScheduleChange}
              onRecallTender={onRecallTender}
              onSendTender={onSendTender}
              tenderSending={tenderSending}
              tenderSendError={tenderSendError}
            />
          </StepPane>

          <StepPane
            active={activeStepId === "contract"}
            unlocked={isOfferPhaseUnlocked(status, "contract")}
            unlockHint="Unlocks once the Tender is signed. Generate the Contract from the Tender data and send it via DocuSign for both parties to sign."
            title="Contract"
          >
            <ContractPanel
              signerStatuses={signerStatuses}
              customerPrice={customerPrice}
              draft={draft}
              job={job}
              paymentSchedule={paymentSchedule}
              status={status}
              contractParticulars={contractParticulars}
              onContractParticularsChange={onContractParticularsChange}
              onGenerateContract={onGenerateContract}
              onMarkContractSigned={onMarkContractSigned}
              onRecallContract={onRecallContract}
              onSendContract={onSendContract}
              contractSending={contractSending}
              contractSendError={contractSendError}
            />
          </StepPane>

          <StepPane
            active={activeStepId === "project"}
            unlocked={isOfferPhaseUnlocked(status, "handoff")}
            unlockHint={"Unlocks once the Contract is signed. Create the Project and seed the costing report from the internal cost lines."}
            title="Project"
          >
            <ProjectHandoffPanel
              customerPrice={customerPrice}
              job={job}
              lines={lines}
              paymentSchedule={paymentSchedule}
              status={status}
              onCreateProject={onCreateProject}
              projectCreating={projectCreating}
              projectResult={projectResult}
            />
          </StepPane>
          </div>
        </div>
      </div>
      <OfferSummaryStrip
        customerPrice={customerPrice}
        effectiveMargin={effectiveMargin}
        pricing={pricing}
        totalAreaSqm={rawTotalAreaSqm(areaBasis)}
      />
    </div>
  );
}

// Statuses at which the Send & negotiate step has actually succeeded. Everything
// else — including rejected, superseded and acceptance-declined — is an outcome
// the rail must not draw a tick for.
const SEND_COMPLETE_STATUSES: ReadonlySet<OfferWorkspaceStatus> = new Set([
  "offer_signed",
  "agreed",
  "tender_draft",
  "tender_sent",
  "tender_signed",
  "tender_declined",
  "contract_draft",
  "contract_sent",
  "contract_signed",
  "contract_declined",
  "project",
]);

// One step's content. Only the selected step mounts, so the page holds one
// step's controls instead of all 384 at once.
function StepPane({
  active,
  locked = false,
  unlocked,
  unlockHint,
  title,
  children,
}: {
  readonly active: boolean;
  readonly locked?: boolean;
  readonly unlocked?: boolean;
  readonly unlockHint?: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  if (!active) {
    return null;
  }
  // A later-phase step that has not unlocked shows why, not an empty panel.
  if (unlocked === false) {
    return (
      <section aria-labelledby="offer-pane-title" className="space-y-4">
        <PaneHeading locked={false} title={title} />
        <OfferPhaseLockNotice hint={unlockHint ?? ""} />
      </section>
    );
  }
  return (
    <section aria-labelledby="offer-pane-title" className="space-y-4">
      <PaneHeading locked={locked} title={title} />
      <OfferStepBody locked={locked}>{children}</OfferStepBody>
    </section>
  );
}

function PaneHeading({
  locked,
  title,
}: {
  readonly locked: boolean;
  readonly title: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2
        id="offer-pane-title"
        className="font-heading text-lg font-semibold leading-tight"
      >
        {title}
      </h2>
      {locked ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" />
          Issued
        </span>
      ) : null}
    </div>
  );
}
