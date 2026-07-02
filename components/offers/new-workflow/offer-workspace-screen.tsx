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
  LegacyWorkbookPricingSettings,
  OfferCustomerPrice,
  OfferWorkspacePricing,
  RateCardComparison,
  RateCardProduct,
  RateCardTier,
} from "@/lib/offer/workspace-pricing";
import { getAreaCalculatorTotalSqm } from "@/lib/offer/workspace-area";
import { AreaCalculatorPanel } from "./offer-workspace-area";
import { CostSchedulePanel } from "./offer-workspace-cost-schedule";
import { OfferDocumentEditor } from "./offer-workspace-document";
import {
  OfferWorkflowSteps,
  OfferWorkspaceHeader,
} from "./offer-workspace-header";
import { JobSetupPanel } from "./offer-workspace-job";
import { LegacyPricingPanel } from "./offer-workspace-legacy-pricing";
import { PaymentSchedulePanel } from "./offer-workspace-payment-schedule";
import {
  OfferDocumentPreview,
  PricingSummary,
} from "./offer-workspace-preview";
import { PricingDecisionPanel } from "./offer-workspace-pricing-decision";
import { RateCardPanel } from "./offer-workspace-rate-card";
import { ScopePanel } from "./offer-workspace-scope";
import { SendNegotiatePanel } from "./offer-workspace-send-negotiate";
import {
  OfferPhaseGate,
  OfferStepSection,
} from "./offer-workspace-step-section";
import { isOfferPhaseUnlocked } from "@/lib/offer/workflow";

type OfferWorkspaceScreenProps = {
  readonly allowances: readonly OfferWorkspaceScopeItem[];
  readonly areaCalculator: OfferAreaCalculator;
  readonly customerPrice: OfferCustomerPrice;
  readonly directTotal: number;
  readonly draft: OfferDocumentDraft;
  readonly exclusions: readonly OfferWorkspaceScopeItem[];
  readonly importResult: OfferWorkbookImportResult | null;
  readonly job: OfferWorkspaceJob;
  readonly legacyPricingSettings: LegacyWorkbookPricingSettings;
  readonly lines: readonly OfferWorkspaceCostLine[];
  readonly overrideReason: string;
  readonly paymentSchedule: readonly OfferPaymentScheduleRow[];
  readonly priceAdjustmentLabel: string;
  readonly pricing: OfferWorkspacePricing;
  readonly rateCardComparison: RateCardComparison;
  readonly rateCardProduct: RateCardProduct;
  readonly rateCardTier: RateCardTier;
  readonly selectedPriceInput: string;
  readonly standardPrice: number | null;
  readonly standardPriceInput: string;
  readonly status: OfferWorkspaceStatus;
  readonly onAddLine: () => void;
  readonly onAllowanceChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onAreaChange: (patch: Partial<OfferAreaCalculator>) => void;
  readonly onDownloadOffer: () => void;
  readonly onDraftChange: (patch: Partial<OfferDocumentDraft>) => void;
  readonly onExclusionChange: (
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) => void;
  readonly onImported: (result: OfferWorkbookImportResult) => void;
  readonly onJobChange: (patch: Partial<OfferWorkspaceJob>) => void;
  readonly onLegacyPricingSettingsChange: (
    patch: Partial<LegacyWorkbookPricingSettings>,
  ) => void;
  readonly onLineChange: (
    lineId: string,
    patch: Partial<OfferWorkspaceCostLine>,
  ) => void;
  readonly onRemoveLine: (lineId: string) => void;
  readonly onMarkSent: () => void;
  readonly onMarkAgreed: () => void;
  readonly onMarkRejected: () => void;
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
  importResult,
  job,
  legacyPricingSettings,
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
  onAddLine,
  onAllowanceChange,
  onAreaChange,
  onDownloadOffer,
  onDraftChange,
  onExclusionChange,
  onImported,
  onJobChange,
  onLegacyPricingSettingsChange,
  onLineChange,
  onRemoveLine,
  onMarkSent,
  onMarkAgreed,
  onMarkRejected,
  onOverrideReasonChange,
  onPaymentScheduleChange,
  onPriceAdjustmentLabelChange,
  onRateCardProductChange,
  onRateCardTierChange,
  onSelectedPriceInputChange,
  onStandardPriceInputChange,
}: OfferWorkspaceScreenProps) {
  return (
    <div
      className="space-y-5 print:hidden"
      aria-labelledby="new-offer-workspace-title"
    >
      <div
        data-offer-sticky-header
        className="sticky top-0 z-30 space-y-5 bg-background pb-4 shadow-[0_-28px_0_0_var(--background)]"
      >
        <OfferWorkspaceHeader
          customerPrice={customerPrice}
          job={job}
          status={status}
          onDownloadPreview={onDownloadOffer}
          onMarkSent={onMarkSent}
        />
        <OfferWorkflowSteps status={status} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          <OfferStepSection
            id="offer-step-job-setup"
            index={1}
            phase="Offer"
            title="Job setup"
          >
            <JobSetupPanel job={job} onJobChange={onJobChange} />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-cost-schedule"
            index={2}
            phase="Offer"
            title="Cost schedule"
          >
            <AreaCalculatorPanel
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
          >
            <LegacyPricingPanel
              directTotal={directTotal}
              settings={legacyPricingSettings}
              totalAreaSqm={getAreaCalculatorTotalSqm(areaCalculator)}
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
            />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-scope"
            index={4}
            phase="Offer"
            title="Scope"
          >
            <ScopePanel
              allowances={allowances}
              exclusions={exclusions}
              onAllowanceChange={onAllowanceChange}
              onExclusionChange={onExclusionChange}
            />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-offer-document"
            index={5}
            phase="Offer"
            title="Offer document"
          >
            <OfferDocumentEditor draft={draft} onDraftChange={onDraftChange} />
          </OfferStepSection>

          <OfferStepSection
            id="offer-step-send"
            index={6}
            phase="Offer"
            title="Send & negotiate"
          >
            <SendNegotiatePanel
              status={status}
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
            <PaymentSchedulePanel
              customerPrice={customerPrice}
              rows={paymentSchedule}
              onRowsChange={onPaymentScheduleChange}
            />
          </OfferPhaseGate>

          <OfferPhaseGate
            id="offer-step-contract"
            index={8}
            phase="Contract"
            title="Contract"
            unlocked={isOfferPhaseUnlocked(status, "contract")}
            unlockHint="Unlocks once the Tender is signed. Generate the Contract from the Tender data and send it via DocuSign for both parties to sign."
          />

          <OfferPhaseGate
            id="offer-step-project"
            index={9}
            phase="Handoff"
            title="Project"
            unlocked={isOfferPhaseUnlocked(status, "handoff")}
            unlockHint="Unlocks once the Contract is signed. Create the Project and seed the costing report from the internal cost lines."
          />
        </div>
        <aside className="min-w-0 space-y-5 xl:sticky xl:top-24 xl:self-start">
          <PricingSummary pricing={pricing} />
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
