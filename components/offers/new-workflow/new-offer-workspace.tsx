"use client";

import {
  DEFAULT_LEGACY_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  applyTaskMappingToCostLine,
  updateOfferScopeItems,
  type OfferDocumentDraft,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import {
  INITIAL_PAYMENT_SCHEDULE,
  type OfferPaymentScheduleRow,
} from "@/lib/offer/workspace-payment-schedule";
import {
  INITIAL_AREA_CALCULATOR,
  getAreaCalculatorTotalSqm,
  type OfferAreaCalculator,
} from "@/lib/offer/workspace-area";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import {
  type LegacyWorkbookPricingSettings,
  calculateDirectTotal,
  calculateRateCardComparison,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  parseNonNegativeNumberInput,
  type OfferWorkspacePricingSettings,
  type RateCardProduct,
  type RateCardTier,
} from "@/lib/offer/workspace-pricing";
import { useMemo, useRef, useState } from "react";
import { OfferWorkspacePrintTemplate } from "./offer-workspace-print-template";
import { OfferWorkspaceScreen } from "./offer-workspace-screen";

export function NewOfferWorkspace() {
  const [job, setJob] = useState<OfferWorkspaceJob>(INITIAL_OFFER_JOB);
  const [lines, setLines] =
    useState<readonly OfferWorkspaceCostLine[]>(INITIAL_COST_LINES);
  const [allowances, setAllowances] =
    useState<readonly OfferWorkspaceScopeItem[]>(INITIAL_ALLOWANCES);
  const [exclusions, setExclusions] =
    useState<readonly OfferWorkspaceScopeItem[]>(INITIAL_EXCLUSIONS);
  const [draft, setDraft] = useState<OfferDocumentDraft>(INITIAL_OFFER_DRAFT);
  const [overrideReason, setOverrideReason] = useState(
    "EOFY fixed price approved from proposal after workbook build-up review.",
  );
  const [selectedPriceInput, setSelectedPriceInput] = useState("945000");
  const [standardPriceInput, setStandardPriceInput] = useState("975000");
  const [priceAdjustmentLabel, setPriceAdjustmentLabel] = useState(
    "EOFY fixed price",
  );
  const [status, setStatus] = useState<OfferWorkspaceStatus>("pending");
  const [areaCalculator, setAreaCalculator] =
    useState<OfferAreaCalculator>(INITIAL_AREA_CALCULATOR);
  const [workspacePricingSettings, setWorkspacePricingSettings] =
    useState<OfferWorkspacePricingSettings>(DEFAULT_WORKSPACE_PRICING_SETTINGS);
  const [legacyPricingSettings, setLegacyPricingSettings] =
    useState<LegacyWorkbookPricingSettings>(DEFAULT_LEGACY_PRICING_SETTINGS);
  const [importResult, setImportResult] =
    useState<OfferWorkbookImportResult | null>(null);
  const [rateCardProduct, setRateCardProduct] =
    useState<RateCardProduct>("DOUBLE_STOREY");
  const [rateCardTier, setRateCardTier] = useState<RateCardTier>("MID");
  const [paymentSchedule, setPaymentSchedule] =
    useState<readonly OfferPaymentScheduleRow[]>(INITIAL_PAYMENT_SCHEDULE);
  const manualLineCounterRef = useRef(0);

  const totalAreaSqm = useMemo(
    () => getAreaCalculatorTotalSqm(areaCalculator),
    [areaCalculator],
  );
  const directTotal = useMemo(() => calculateDirectTotal(lines), [lines]);
  const pricing = useMemo(
    () =>
        calculateOfferWorkspacePricing({
          directTotal,
          totalAreaSqm,
          settings: workspacePricingSettings,
        }),
    [directTotal, totalAreaSqm, workspacePricingSettings],
  );
  const selectedPrice =
    selectedPriceInput.length === 0
      ? null
      : parseNonNegativeNumberInput(selectedPriceInput);
  const customerPrice = useMemo(
    () =>
      calculateOfferCustomerPrice({
        computedContractValueIncGst: pricing.contractValueIncGst,
        selectedContractValueIncGst: selectedPrice,
        overrideReason,
      }),
    [overrideReason, pricing, selectedPrice],
  );
  const standardPrice =
    standardPriceInput.length === 0
      ? null
      : parseNonNegativeNumberInput(standardPriceInput);
  const rateCardComparison = useMemo(
    () =>
      calculateRateCardComparison({
        product: rateCardProduct,
        tier: rateCardTier,
        totalAreaSqm,
        selectedContractValueIncGst:
          customerPrice.selectedContractValueIncGst,
      }),
    [customerPrice, rateCardProduct, rateCardTier, totalAreaSqm],
  );

  function updateJob(patch: Partial<OfferWorkspaceJob>) {
    setJob((current) => ({ ...current, ...patch }));
  }

  function updateLine(
    lineId: string,
    patch: Partial<OfferWorkspaceCostLine>,
  ) {
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

  function updateDraft(patch: Partial<OfferDocumentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateAreaCalculator(patch: Partial<OfferAreaCalculator>) {
    const nextArea = { ...areaCalculator, ...patch };
    setAreaCalculator(nextArea);
    setJob((current) => ({
      ...current,
      groundFloorSqm: nextArea.groundFloorSqm,
      firstFloorSqm: nextArea.firstFloorSqm,
      garageSqm: nextArea.garageSqm,
      alfrescoPorchSqm: nextArea.alfrescoSqm,
      porchSqm: nextArea.porchSqm,
      grannyFlatSqm: nextArea.grannyFlatSqm,
    }));
  }

  function updateLegacyPricingSettings(
    patch: Partial<LegacyWorkbookPricingSettings>,
  ) {
    setLegacyPricingSettings((current) => ({ ...current, ...patch }));
  }

  function importWorkbook(result: OfferWorkbookImportResult) {
    setImportResult(result);
    setLines(result.costLines);
    setAreaCalculator(result.areaCalculator);
    setWorkspacePricingSettings(result.workspacePricingSettings);
    setLegacyPricingSettings(result.legacyPricingSettings);
    setJob((current) => ({
      ...current,
      groundFloorSqm: result.areaCalculator.groundFloorSqm,
      firstFloorSqm: result.areaCalculator.firstFloorSqm,
      garageSqm: result.areaCalculator.garageSqm,
      alfrescoPorchSqm: result.areaCalculator.alfrescoSqm,
      porchSqm: result.areaCalculator.porchSqm,
      grannyFlatSqm: result.areaCalculator.grannyFlatSqm,
    }));
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

  return (
    <>
      <OfferWorkspaceScreen
        allowances={allowances}
        areaCalculator={areaCalculator}
        customerPrice={customerPrice}
        directTotal={directTotal}
        draft={draft}
        exclusions={exclusions}
        importResult={importResult}
        job={job}
        legacyPricingSettings={legacyPricingSettings}
        lines={lines}
        overrideReason={overrideReason}
        paymentSchedule={paymentSchedule}
        priceAdjustmentLabel={priceAdjustmentLabel}
        pricing={pricing}
        rateCardComparison={rateCardComparison}
        rateCardProduct={rateCardProduct}
        rateCardTier={rateCardTier}
        selectedPriceInput={selectedPriceInput}
        standardPrice={standardPrice}
        standardPriceInput={standardPriceInput}
        status={status}
        onAddLine={addLine}
        onAllowanceChange={updateAllowance}
        onAreaChange={updateAreaCalculator}
        onDownloadOffer={() => window.print()}
        onDraftChange={updateDraft}
        onExclusionChange={updateExclusion}
        onImported={importWorkbook}
        onJobChange={updateJob}
        onLegacyPricingSettingsChange={updateLegacyPricingSettings}
        onLineChange={updateLine}
        onMarkSent={() => setStatus("sent")}
        onMarkAgreed={() => setStatus("agreed")}
        onMarkRejected={() => setStatus("rejected")}
        onOverrideReasonChange={setOverrideReason}
        onPaymentScheduleChange={setPaymentSchedule}
        onPriceAdjustmentLabelChange={setPriceAdjustmentLabel}
        onRateCardProductChange={setRateCardProduct}
        onRateCardTierChange={setRateCardTier}
        onSelectedPriceInputChange={setSelectedPriceInput}
        onStandardPriceInputChange={setStandardPriceInput}
        onRemoveLine={removeLine}
      />
      <OfferWorkspacePrintTemplate
        allowances={allowances}
        customerPrice={customerPrice}
        draft={draft}
        exclusions={exclusions}
        job={job}
        lines={lines}
        paymentSchedule={paymentSchedule}
        priceAdjustmentLabel={priceAdjustmentLabel}
        standardPriceIncGst={standardPrice}
      />
    </>
  );
}
