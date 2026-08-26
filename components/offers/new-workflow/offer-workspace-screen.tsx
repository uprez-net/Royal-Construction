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
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { buildOfferImageContext } from "@/lib/offer/offer-image-context";
import type { OfferSignerStatus } from "@/lib/offer/signing-status";
import {
  deriveTenderGateStatus,
  type TenderGateState,
} from "@/lib/offer/workspace-persistence";
import { formatOfferReference } from "./offer-workspace-format";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AreaCalculatorPanel } from "./offer-workspace-area";
import { CostSchedulePanel } from "./offer-workspace-cost-schedule";
import { OfferDocumentCanvas } from "./offer-document-canvas";
import {
  OfferWorkflowSteps,
  OfferWorkspaceHeader,
} from "./offer-workspace-header";
import { JobSetupPanel } from "./offer-workspace-job";
import { PriceBuildupPanel } from "./offer-workspace-price-buildup";
import { ContractPanel } from "./offer-workspace-contract";
import { ProjectHandoffPanel } from "./offer-workspace-project-handoff";
import { TenderPanel } from "./offer-workspace-tender";
import { PricingSummary } from "./offer-workspace-pricing-summary";
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
  OfferPhaseGate,
  OfferStepSection,
  type OfferStepStatus,
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

export type OfferSaveState = "idle" | "saving" | "saved" | "error";

type OfferWorkspaceScreenProps = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
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

  // Per-step completeness badges, keyed by the step section id.
  const stepStatusById = useMemo(() => {
    const map = new Map<string, OfferStepStatus>();
    for (const s of reviewSections) {
      map.set(
        s.stepId,
        s.status === "complete"
          ? { tone: "complete", label: "Complete" }
          : { tone: "incomplete", label: "Incomplete" },
      );
    }
    return map;
  }, [reviewSections]);

  // Send & negotiate is an action step, so its badge reflects the offer's state
  // rather than data completeness.
  const sendStatus: OfferStepStatus =
    status === "pending"
      ? { tone: "incomplete", label: "Not sent" }
      : status === "sent"
        ? { tone: "neutral", label: "Sent" }
        : status === "offer_sent"
          ? { tone: "neutral", label: "Acceptance sent" }
          : status === "offer_signed"
            ? { tone: "complete", label: "Accepted" }
            : status === "offer_declined"
              ? { tone: "neutral", label: "Acceptance declined" }
              : status === "rejected"
                ? { tone: "neutral", label: "Rejected" }
                : status === "superseded"
                  ? { tone: "neutral", label: "Superseded" }
                  : { tone: "complete", label: "Agreed" };

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

  // The header + stepper are pinned (sticky top-0) and their height changes with
  // viewport width as the title/badges/price reflow. Measure it live and expose
  // it as `--offer-sticky-offset` so the sticky sidebar (its `top`) and every
  // step section (its `scroll-margin-top`) clear the chrome exactly, instead of
  // relying on hardcoded guesses that leave content tucked behind the header.
  const stickyRef = useRef<HTMLDivElement>(null);
  const [stickyOffset, setStickyOffset] = useState(288);

  // Tender access gate (Step 7). The gate only holds the Tender panel while
  // the offer is at AGREED — once a Tender is generated (tender_draft+) the
  // gate is moot and the panel stays reachable.
  const tenderGateStatus = deriveTenderGateStatus(tenderGate);
  const gateUnlocked = tenderGateStatus === "unlocked";
  const tenderPanelUnlocked =
    isOfferPhaseUnlocked(status, "tender") &&
    (status !== "agreed" || gateUnlocked);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) {
      return;
    }
    const measure = () =>
      setStickyOffset(el.getBoundingClientRect().height + 12);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="space-y-5 print:hidden"
      aria-labelledby="new-offer-workspace-title"
      style={{ "--offer-sticky-offset": `${stickyOffset}px` } as CSSProperties}
    >
      <div
        ref={stickyRef}
        data-offer-sticky-header
        className="sticky top-0 z-30 space-y-5 bg-background pb-4 shadow-[0_-28px_0_0_var(--background)]"
      >
        <OfferWorkspaceHeader
          customerPrice={customerPrice}
          job={job}
          leadId={leadId}
          status={status}
          offerExpiry={offerExpiry}
          saveState={saveState}
          onDownloadPreview={onDownloadOffer}
        />
        <OfferWorkflowSteps
          status={status}
          tenderGateStatus={tenderGateStatus}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          {offerIssued ? (
            <OfferLockBanner
              canRevise={canRevise}
              revising={revising}
              executed={revisionExecuted}
              documentsEditable={documentsStillEditable}
              notice={revisionNotice}
              onCreateRevision={onCreateRevision}
            />
          ) : null}
          <OfferStepSection
            id="offer-step-job-setup"
            index={1}
            phase="Offer"
            title="Job setup"
            locked={jobSetupLocked}
            status={stepStatusById.get("offer-step-job-setup") ?? null}
          >
            <JobSetupPanel
              job={job}
              onJobChange={onJobChange}
              onPrefillFromLead={onPrefillFromLead}
              canPrefill={canPrefill}
              prefilling={prefilling}
              prefillResult={prefillResult}
            />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-cost-schedule"
            index={2}
            phase="Offer"
            title="Cost schedule"
            locked={costScheduleLocked}
            status={stepStatusById.get("offer-step-cost-schedule") ?? null}
          >
            <AreaCalculatorPanel
              job={job}
              basis={areaBasis}
              area={areaCalculator}
              rateConstants={rateConstants}
              onAreaChange={onAreaChange}
              onJobChange={onJobChange}
            />
            <CostSchedulePanel
              importResult={importResult}
              lines={lines}
              onAddLine={onAddLine}
              onImported={onImported}
              onLineChange={onLineChange}
              onIncludeAll={onIncludeAll}
              onRemoveLine={onRemoveLine}
            />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-pricing"
            index={3}
            phase="Offer"
            title="Pricing"
            locked={pricingLocked}
            status={stepStatusById.get("offer-step-pricing") ?? null}
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
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-scope"
            index={4}
            phase="Offer"
            title="Scope"
            locked={scopeLocked}
            status={stepStatusById.get("offer-step-scope") ?? null}
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
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-offer-document"
            index={5}
            phase="Offer"
            title="Offer document"
            locked={offerDocumentLocked}
            status={stepStatusById.get("offer-step-offer-document") ?? null}
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
                images={images}
                onImageChange={onImageChange}
                leadId={leadId}
                buildType={job.buildType}
                finishContexts={imageFinishContexts}
              />
            </div>
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-send"
            index={6}
            phase="Offer"
            title="Send & negotiate"
            status={sendStatus}
          >
            <SendNegotiatePanel
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
          </OfferStepSection>

          <OfferPhaseGate
            id="offer-step-tender-gate"
            index={7}
            phase="Tender"
            title="Tender access"
            unlocked={isOfferPhaseUnlocked(status, "tender")}
            unlockHint="Unlocks once the Offer is agreed. Decide whether tender access unlocks immediately or is held pending an architectural-plan fee and upload."
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
          </OfferPhaseGate>

          <OfferPhaseGate
            id="offer-step-tender"
            index={8}
            phase="Tender"
            title="Tender"
            unlocked={tenderPanelUnlocked}
            unlockHint={
              gateUnlocked
                ? "Unlocks once the Offer is agreed. Decide the payment schedule, generate the Tender, and send it for signature via DocuSign."
                : "Complete the Tender access step above to unlock the Tender."
            }
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
          </OfferPhaseGate>

          <OfferPhaseGate
            id="offer-step-contract"
            index={9}
            phase="Contract"
            title="Contract"
            unlocked={isOfferPhaseUnlocked(status, "contract")}
            unlockHint="Unlocks once the Tender is signed. Generate the Contract from the Tender data and send it via DocuSign for both parties to sign."
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
          </OfferPhaseGate>

          <OfferPhaseGate
            id="offer-step-project"
            index={10}
            phase="Handoff"
            title="Project"
            unlocked={isOfferPhaseUnlocked(status, "handoff")}
            unlockHint="Unlocks once the Contract is signed. Create the Project and seed the costing report from the internal cost lines."
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
          </OfferPhaseGate>
        </div>
        <aside className="min-w-0 space-y-5 xl:sticky xl:top-(--offer-sticky-offset,18rem) xl:self-start">
          <PricingSummary effectiveMargin={effectiveMargin} pricing={pricing} />
        </aside>
      </div>
    </div>
  );
}
