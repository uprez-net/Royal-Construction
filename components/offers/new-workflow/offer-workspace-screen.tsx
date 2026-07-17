"use client";

import type {
  OfferDocumentDraft,
  OfferWorkspaceCostLine,
  OfferWorkspaceJob,
  OfferWorkspaceScopeItem,
  OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import type { OfferPaymentScheduleRow } from "@/lib/offer/workspace-payment-schedule";
import type { OfferAreaCalculator } from "@/lib/offer/workspace-area";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import type {
  EffectiveMargin,
  LegacyWorkbookPricingSettings,
  OfferCustomerPrice,
  OfferWorkspacePricing,
  RateCardComparison,
  RateCardProduct,
  RateCardTier,
} from "@/lib/offer/workspace-pricing";
import {
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
} from "@/lib/offer/workspace-area";
import { buildOfferImageContext } from "@/lib/offer/offer-image-context";
import { formatOfferReference } from "./offer-workspace-format";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AreaCalculatorPanel } from "./offer-workspace-area";
import { CostSchedulePanel } from "./offer-workspace-cost-schedule";
import { OfferDocumentEditor } from "./offer-workspace-document";
import {
  OfferWorkflowSteps,
  OfferWorkspaceHeader,
} from "./offer-workspace-header";
import { JobSetupPanel } from "./offer-workspace-job";
import { LegacyPricingPanel } from "./offer-workspace-legacy-pricing";
import { ContractPanel } from "./offer-workspace-contract";
import { ProjectHandoffPanel } from "./offer-workspace-project-handoff";
import { TenderPanel } from "./offer-workspace-tender";
import {
  OfferDocumentPreview,
  PricingSummary,
} from "./offer-workspace-preview";
import { PricingDecisionPanel } from "./offer-workspace-pricing-decision";
import { RateCardPanel } from "./offer-workspace-rate-card";
import { ScopePanel } from "./offer-workspace-scope";
import { OfferWorkspaceImages } from "./offer-workspace-images";
import type {
  OfferImage,
  OfferImageMap,
  OfferImageSlotKey,
} from "@/lib/offer/workspace-images";
import { SendNegotiatePanel } from "./offer-workspace-send-negotiate";
import {
  OfferLockBanner,
  OfferPhaseGate,
  OfferStepSection,
} from "./offer-workspace-step-section";
import { isOfferPhaseUnlocked } from "@/lib/offer/workflow";
import type {
  OfferExpiry,
  OfferSendBlocker,
} from "@/lib/offer/offer-readiness";

export type OfferSaveState = "idle" | "saving" | "saved" | "error";

type OfferWorkspaceScreenProps = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly areaCalculator: OfferAreaCalculator;
  readonly customerPrice: OfferCustomerPrice;
  readonly directTotal: number;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly images: OfferImageMap;
  readonly importResult: OfferWorkbookImportResult | null;
  readonly job: OfferWorkspaceJob;
  readonly leadId?: number;
  readonly legacyPricingSettings: LegacyWorkbookPricingSettings;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly overrideReason: string;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly priceAdjustmentLabel: string;
  readonly pricing: OfferWorkspacePricing;
  readonly effectiveMargin: EffectiveMargin;
  readonly rateCardComparison: RateCardComparison;
  readonly rateCardProduct: RateCardProduct;
  readonly rateCardTier: RateCardTier;
  readonly selectedPriceInput: string;
  readonly standardPrice: number | null;
  readonly standardPriceInput: string;
  readonly status: OfferWorkspaceStatus;
  readonly offerExpiry: OfferExpiry | null;
  readonly saveState: OfferSaveState;
  readonly sendBlockers: readonly OfferSendBlocker[];
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
  readonly prefillResult?: import("@/lib/data/offer-prefill").OfferPrefillResult | null;
  readonly onLegacyPricingSettingsChange: (
    patch: Partial<LegacyWorkbookPricingSettings>,
  ) => void;
  readonly onLineChange: (
    lineId: string,
    patch: Partial<OfferWorkspaceCostLine>,
  ) => void;
  readonly onRemoveLine: (lineId: string) => void;
  readonly onMarkSent: () => void;
  readonly canMarkSent: boolean;
  readonly onMarkAgreed: () => void;
  readonly onMarkRejected: () => void;
  readonly onCreateRevision: () => void;
  readonly canRevise: boolean;
  readonly revising: boolean;
  readonly revisionNotice: string | null;
  readonly revisionExecuted: boolean;
  readonly onSendOffer: (email: string) => void;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly sendError: string | null;
  readonly sentInfo: string | null;
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
  readonly onRecallContract: () => void;
  readonly onMarkContractSigned: () => void;
  readonly onCreateProject: () => void;
  readonly projectCreating?: boolean;
  readonly projectResult?: import("@/lib/data/offer-project-handoff").ProjectHandoffResult | null;
  readonly onOverrideReasonChange: (value: string) => void;
  readonly onPaymentScheduleChange: (
    rows: readonly OfferPaymentScheduleRow[],
  ) => void;
  readonly onPriceAdjustmentLabelChange: (value: string) => void;
  readonly onRateCardProductChange: (value: RateCardProduct) => void;
  readonly onRateCardTierChange: (value: RateCardTier) => void;
  readonly onSelectedPriceInputChange: (value: string) => void;
  readonly onStandardPriceInputChange: (value: string) => void;
};

export function OfferWorkspaceScreen({
  allowances,
  areaCalculator,
  customerPrice,
  directTotal,
  draft,
  exclusions,
  images,
  importResult,
  job,
  leadId,
  legacyPricingSettings,
  effectiveMargin,
  lines,
  overrideReason,
  paymentSchedule,
  priceAdjustmentLabel,
  pricing,
  rateCardComparison,
  rateCardProduct,
  rateCardTier,
  selectedPriceInput,
  standardPrice,
  standardPriceInput,
  status,
  offerExpiry,
  saveState,
  sendBlockers,
  onAddLine,
  onAllowanceChange,
  onAddAllowance,
  onRemoveAllowance,
  onAddExclusion,
  onRemoveExclusion,
  onAreaChange,
  onDownloadOffer,
  onDraftChange,
  onImageChange,
  onExclusionChange,
  onImported,
  onJobChange,
  onPrefillFromLead,
  canPrefill,
  prefilling,
  prefillResult,
  onLegacyPricingSettingsChange,
  onLineChange,
  onRemoveLine,
  onMarkSent,
  canMarkSent,
  onMarkAgreed,
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
  onRecallContract,
  onMarkContractSigned,
  onCreateProject,
  projectCreating,
  projectResult,
  onOverrideReasonChange,
  onPaymentScheduleChange,
  onPriceAdjustmentLabelChange,
  onRateCardProductChange,
  onRateCardTierChange,
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

  // Once the offer has been issued (Sent or any later/terminal state), the
  // Offer-build steps are locked to preserve the issued record — changes go
  // through a new revision. `pending` is the only editable state.
  const isOfferLocked = status !== "pending";

  // The header + stepper are pinned (sticky top-0) and their height changes with
  // viewport width as the title/badges/price reflow. Measure it live and expose
  // it as `--offer-sticky-offset` so the sticky sidebar (its `top`) and every
  // step section (its `scroll-margin-top`) clear the chrome exactly, instead of
  // relying on hardcoded guesses that leave content tucked behind the header.
  const stickyRef = useRef<HTMLDivElement>(null);
  const [stickyOffset, setStickyOffset] = useState(288);
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) {
      return;
    }
    const measure = () => setStickyOffset(el.getBoundingClientRect().height + 12);
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
        <OfferWorkflowSteps status={status} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          {isOfferLocked ? (
            <OfferLockBanner
              canRevise={canRevise}
              revising={revising}
              executed={revisionExecuted}
              notice={revisionNotice}
              onCreateRevision={onCreateRevision}
            />
          ) : null}
          <OfferStepSection
            id="offer-step-job-setup"
            index={1}
            phase="Offer"
            title="Job setup"
            locked={isOfferLocked}
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
            locked={isOfferLocked}
          >
            <AreaCalculatorPanel
              basis={areaBasis}
              area={areaCalculator}
              onAreaChange={onAreaChange}
            />
            <CostSchedulePanel
              importResult={importResult}
              lines={lines}
              onAddLine={onAddLine}
              onImported={onImported}
              onLineChange={onLineChange}
              onRemoveLine={onRemoveLine}
            />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-pricing"
            index={3}
            phase="Offer"
            title="Pricing"
            locked={isOfferLocked}
          >
            <LegacyPricingPanel
              directTotal={directTotal}
              settings={legacyPricingSettings}
              totalAreaSqm={getAreaBasisTotalSqm(areaBasis)}
              onSettingsChange={onLegacyPricingSettingsChange}
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
            <RateCardPanel
              comparison={rateCardComparison}
              product={rateCardProduct}
              tier={rateCardTier}
              onProductChange={onRateCardProductChange}
              onTierChange={onRateCardTierChange}
              onSelectedPriceInputChange={onSelectedPriceInputChange}
            />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-scope"
            index={4}
            phase="Offer"
            title="Scope"
            locked={isOfferLocked}
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
            locked={isOfferLocked}
          >
            <div className="space-y-6">
              <OfferDocumentEditor draft={draft} onDraftChange={onDraftChange} />
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
          >
            <SendNegotiatePanel
              status={status}
              canRevise={canRevise}
              revising={revising}
              clientEmail={job.clientEmail}
              contractValueIncGst={customerPrice.selectedContractValueIncGst}
              offerReference={formatOfferReference(job.reference, job.revision)}
              sendBlockers={sendBlockers}
              canSend={canSend}
              sending={sending}
              sendError={sendError}
              sentInfo={sentInfo}
              canMarkSent={canMarkSent}
              onSendOffer={onSendOffer}
              onMarkSent={onMarkSent}
              onCreateRevision={onCreateRevision}
              onMarkAgreed={onMarkAgreed}
              onMarkRejected={onMarkRejected}
            />
          </OfferStepSection>

          <OfferPhaseGate
            id="offer-step-tender"
            index={7}
            phase="Tender"
            title="Tender"
            unlocked={isOfferPhaseUnlocked(status, "tender")}
            unlockHint="Unlocks once the Offer is agreed. Decide the payment schedule, generate the Tender, and send it for signature via DocuSign."
          >
            <TenderPanel
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
            index={8}
            phase="Contract"
            title="Contract"
            unlocked={isOfferPhaseUnlocked(status, "contract")}
            unlockHint="Unlocks once the Tender is signed. Generate the Contract from the Tender data and send it via DocuSign for both parties to sign."
          >
            <ContractPanel
              customerPrice={customerPrice}
              draft={draft}
              job={job}
              paymentSchedule={paymentSchedule}
              status={status}
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
            index={9}
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
        <aside className="min-w-0 space-y-5 xl:sticky xl:top-[var(--offer-sticky-offset,18rem)] xl:self-start">
          <PricingSummary effectiveMargin={effectiveMargin} pricing={pricing} />
          <OfferDocumentPreview
            customerPrice={customerPrice}
            draft={draft}
            exclusions={exclusions}
            job={job}
            lines={lines}
            pricing={pricing}
            priceAdjustmentLabel={priceAdjustmentLabel}
            standardPriceIncGst={standardPrice}
          />
        </aside>
      </div>
    </div>
  );
}
