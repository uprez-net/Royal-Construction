"use client";

import {
  DEFAULT_LEGACY_PRICING_SETTINGS,
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  type OfferDocumentDraft,
  type OfferWorkspaceCostLine,
  type OfferWorkspaceJob,
  type OfferWorkspaceScopeItem,
  type OfferWorkspaceStatus,
} from "@/lib/offer/workspace-model";
import {
  INITIAL_AREA_CALCULATOR,
  getAreaCalculatorTotalSqm,
  type OfferAreaCalculator,
} from "@/lib/offer/workspace-area";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import {
  type LegacyWorkbookPricingSettings,
  calculateDirectTotal,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  parseNonNegativeNumberInput,
} from "@/lib/offer/workspace-pricing";
import { useMemo, useRef, useState } from "react";
import { AreaCalculatorPanel } from "./offer-workspace-area";
import { CostSchedulePanel } from "./offer-workspace-cost-schedule";
import { OfferDocumentEditor } from "./offer-workspace-document";
import {
  OfferWorkflowSteps,
  OfferWorkspaceHeader,
} from "./offer-workspace-header";
import { JobSetupPanel } from "./offer-workspace-job";
import {
  OfferDocumentPreview,
  PricingSummary,
} from "./offer-workspace-preview";
import { LegacyPricingPanel } from "./offer-workspace-legacy-pricing";
import { PricingDecisionPanel } from "./offer-workspace-pricing-decision";
import { ScopePanel } from "./offer-workspace-scope";

function getTotalArea(job: OfferWorkspaceJob): number {
  return (
    job.groundFloorSqm +
    job.firstFloorSqm +
    job.garageSqm +
    job.alfrescoPorchSqm +
    job.porchSqm +
    job.grannyFlatSqm
  );
}

export function NewOfferWorkspace() {
  const [job, setJob] = useState<OfferWorkspaceJob>(INITIAL_OFFER_JOB);
  const [lines, setLines] =
    useState<readonly OfferWorkspaceCostLine[]>(INITIAL_COST_LINES);
  const [allowances, setAllowances] =
    useState<readonly OfferWorkspaceScopeItem[]>(INITIAL_ALLOWANCES);
  const [exclusions, setExclusions] =
    useState<readonly OfferWorkspaceScopeItem[]>(INITIAL_EXCLUSIONS);
  const [draft, setDraft] = useState<OfferDocumentDraft>(INITIAL_OFFER_DRAFT);
  const [overrideReason, setOverrideReason] = useState("");
  const [selectedPriceInput, setSelectedPriceInput] = useState("");
  const [status, setStatus] = useState<OfferWorkspaceStatus>("pending");
  const [areaCalculator, setAreaCalculator] =
    useState<OfferAreaCalculator>(INITIAL_AREA_CALCULATOR);
  const [legacyPricingSettings, setLegacyPricingSettings] =
    useState<LegacyWorkbookPricingSettings>(DEFAULT_LEGACY_PRICING_SETTINGS);
  const [importResult, setImportResult] =
    useState<OfferWorkbookImportResult | null>(null);
  const manualLineCounterRef = useRef(0);

  const directTotal = useMemo(() => calculateDirectTotal(lines), [lines]);
  const pricing = useMemo(
    () =>
      calculateOfferWorkspacePricing({
        directTotal,
        totalAreaSqm: getTotalArea(job),
        settings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
      }),
    [directTotal, job],
  );
  const selectedPrice = parseSelectedPrice(selectedPriceInput);
  const customerPrice = useMemo(
    () =>
      calculateOfferCustomerPrice({
        computedContractValueIncGst: pricing.contractValueIncGst,
        selectedContractValueIncGst: selectedPrice,
        overrideReason,
      }),
    [overrideReason, pricing, selectedPrice],
  );

  function updateJob(patch: Partial<OfferWorkspaceJob>) {
    setJob((current) => ({ ...current, ...patch }));
  }

  function updateLine(
    lineId: string,
    patch: Partial<OfferWorkspaceCostLine>,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.id === lineId ? { ...line, ...patch } : line,
      ),
    );
  }

  function updateAllowance(
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) {
    setAllowances((current) => updateScopeItems(current, itemId, patch));
  }

  function updateExclusion(
    itemId: string,
    patch: Partial<OfferWorkspaceScopeItem>,
  ) {
    setExclusions((current) => updateScopeItems(current, itemId, patch));
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
        tradeOrVendor: "",
        notesOrSpec: "",
        costExGst: 0,
        includedInContract: true,
      },
    ]);
  }

  return (
    <div className="space-y-5" aria-labelledby="new-offer-workspace-title">
      <OfferWorkspaceHeader
        customerPrice={customerPrice}
        job={job}
        status={status}
        onDownloadPreview={() => window.print()}
        onMarkSent={() => setStatus("sent")}
      />
      <OfferWorkflowSteps />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 space-y-5">
          <JobSetupPanel job={job} onJobChange={updateJob} />
          <AreaCalculatorPanel
            area={areaCalculator}
            onAreaChange={updateAreaCalculator}
          />
          <CostSchedulePanel
            importResult={importResult}
            lines={lines}
            onAddLine={addLine}
            onImported={importWorkbook}
            onLineChange={updateLine}
          />
          <LegacyPricingPanel
            directTotal={directTotal}
            settings={legacyPricingSettings}
            totalAreaSqm={getAreaCalculatorTotalSqm(areaCalculator)}
            onSettingsChange={updateLegacyPricingSettings}
          />
          <PricingDecisionPanel
            customerPrice={customerPrice}
            overrideReason={overrideReason}
            selectedPriceInput={selectedPriceInput}
            onOverrideReasonChange={setOverrideReason}
            onSelectedPriceInputChange={setSelectedPriceInput}
          />
          <ScopePanel
            allowances={allowances}
            exclusions={exclusions}
            onAllowanceChange={updateAllowance}
            onExclusionChange={updateExclusion}
          />
          <OfferDocumentEditor draft={draft} onDraftChange={updateDraft} />
        </main>

        <aside className="min-w-0 space-y-5 xl:sticky xl:top-24 xl:self-start">
          <PricingSummary pricing={pricing} />
          <OfferDocumentPreview
            customerPrice={customerPrice}
            draft={draft}
            exclusions={exclusions}
            job={job}
            pricing={pricing}
          />
        </aside>
      </div>
    </div>
  );
}

function parseSelectedPrice(value: string): number | null {
  if (value.length === 0) {
    return null;
  }

  return parseNonNegativeNumberInput(value);
}

function updateScopeItems(
  items: readonly OfferWorkspaceScopeItem[],
  itemId: string,
  patch: Partial<OfferWorkspaceScopeItem>,
): readonly OfferWorkspaceScopeItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, ...patch } : item));
}
