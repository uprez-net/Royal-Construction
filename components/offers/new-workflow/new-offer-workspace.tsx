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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfferStatus } from "@prisma/client";
import {
  loadActiveOfferWorkspace,
  saveOfferWorkspace,
  transitionOfferStatus,
  createOfferRevision,
} from "@/lib/data/offer-workspace";
import { sendOfferDocument } from "@/lib/data/offer-send";
import { sendTenderForSignature } from "@/lib/data/offer-tender-sign";
import { sendContractForSignature } from "@/lib/data/offer-contract-sign";
import {
  createProjectFromOffer,
  type ProjectHandoffResult,
} from "@/lib/data/offer-project-handoff";
import type { OfferWorkspaceSnapshot } from "@/lib/offer/workspace-persistence";
import {
  EMPTY_OFFER_IMAGES,
  setOfferImage,
  type OfferImage,
  type OfferImageMap,
  type OfferImageSlotKey,
} from "@/lib/offer/workspace-images";
import { OfferWorkspacePrintTemplate } from "./offer-workspace-print-template";
import { OfferWorkspaceScreen } from "./offer-workspace-screen";

// Embed with a leadId to persist to the DB (ADR 0002). The standalone
// /offers/new-workflow demo route passes none and stays in-memory.
export function NewOfferWorkspace({ leadId }: { readonly leadId: number }) {
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
  const [images, setImages] = useState<OfferImageMap>(EMPTY_OFFER_IMAGES);
  const [revising, setRevising] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<string | null>(null);
  const [tenderSending, setTenderSending] = useState(false);
  const [tenderSendError, setTenderSendError] = useState<string | null>(null);
  const [contractSending, setContractSending] = useState(false);
  const [contractSendError, setContractSendError] = useState<string | null>(null);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectResult, setProjectResult] = useState<ProjectHandoffResult | null>(null);
  const manualLineCounterRef = useRef(0);

  function updateImage(key: OfferImageSlotKey, image: OfferImage | null) {
    setImages((current) => setOfferImage(current, key, image));
  }

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
      legacyPricingSettings,
      paymentSchedule,
      rateCardProduct,
      rateCardTier,
      overrideReason,
      selectedPriceInput,
      standardPriceInput,
      priceAdjustmentLabel,
      images,
    }),
    [
      job,
      lines,
      allowances,
      exclusions,
      draft,
      areaCalculator,
      workspacePricingSettings,
      legacyPricingSettings,
      paymentSchedule,
      rateCardProduct,
      rateCardTier,
      overrideReason,
      selectedPriceInput,
      standardPriceInput,
      priceAdjustmentLabel,
      images,
    ],
  );

  const offerIdRef = useRef<string | null>(null);
  const stateVersionRef = useRef(0);
  const lastSavedRef = useRef<string | null>(null);
  const snapshotRef = useRef(snapshot);
  // Keep the "latest snapshot" ref for event handlers; refs must not be
  // written during render, so sync it in an effect.
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const hydrateSnapshot = useCallback((s: OfferWorkspaceSnapshot) => {
    setJob(s.job);
    setLines(s.lines);
    setAllowances(s.allowances);
    setExclusions(s.exclusions);
    setDraft(s.draft);
    setAreaCalculator(s.areaCalculator);
    setWorkspacePricingSettings(s.workspacePricingSettings);
    setLegacyPricingSettings(s.legacyPricingSettings);
    setPaymentSchedule(s.paymentSchedule);
    setRateCardProduct(s.rateCardProduct);
    setRateCardTier(s.rateCardTier);
    setOverrideReason(s.overrideReason);
    setSelectedPriceInput(s.selectedPriceInput);
    setStandardPriceInput(s.standardPriceInput);
    setPriceAdjustmentLabel(s.priceAdjustmentLabel);
    setImages(s.images);
  }, []);

  // Load the active offer for the lead on mount.
  useEffect(() => {
    if (leadId === undefined) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const loaded = await loadActiveOfferWorkspace(leadId);
      if (cancelled) {
        return;
      }
      offerIdRef.current = loaded.offerId;
      stateVersionRef.current = loaded.stateVersion;
      setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
      if (loaded.snapshot) {
        hydrateSnapshot(loaded.snapshot);
        lastSavedRef.current = JSON.stringify(loaded.snapshot);
      } else {
        lastSavedRef.current = JSON.stringify(snapshotRef.current);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leadId, hydrateSnapshot]);

  // Debounced autosave with optimistic concurrency, while the offer is editable.
  useEffect(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      return;
    }
    if (status !== "pending" && status !== "sent") {
      return; // frozen once agreed
    }
    const currentJson = JSON.stringify(snapshot);
    if (currentJson === lastSavedRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        const result = await saveOfferWorkspace({
          offerId,
          expectedStateVersion: stateVersionRef.current,
          snapshot,
        });
        if (result.ok) {
          stateVersionRef.current = result.stateVersion;
          lastSavedRef.current = currentJson;
        } else if (result.reason === "stale") {
          const loaded = await loadActiveOfferWorkspace(leadId);
          offerIdRef.current = loaded.offerId;
          stateVersionRef.current = loaded.stateVersion;
          if (loaded.snapshot) {
            hydrateSnapshot(loaded.snapshot);
            lastSavedRef.current = JSON.stringify(loaded.snapshot);
          }
        }
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [snapshot, status, leadId, hydrateSnapshot]);

  // Persist a lifecycle transition (flushing the latest state first so AGREED
  // freezes the correct snapshot), then update the UI.
  const transition = useCallback(
    (next: OfferWorkspaceStatus) => {
      const offerId = offerIdRef.current;
      if (leadId !== undefined && offerId !== null) {
        void (async () => {
          const currentJson = JSON.stringify(snapshotRef.current);
          if (currentJson !== lastSavedRef.current) {
            const saved = await saveOfferWorkspace({
              offerId,
              expectedStateVersion: stateVersionRef.current,
              snapshot: snapshotRef.current,
            });
            if (saved.ok) {
              stateVersionRef.current = saved.stateVersion;
              lastSavedRef.current = currentJson;
            }
          }
          await transitionOfferStatus({
            offerId,
            toStatus: next.toUpperCase() as OfferStatus,
          });
        })();
      }
      setStatus(next);
    },
    [leadId],
  );

  // Fork a new active revision (supersedes the current one), then reload the
  // fresh revision into the workspace.
  const createRevision = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      return;
    }
    setRevising(true);
    void (async () => {
      try {
        const result = await createOfferRevision({ offerId });
        if (result.ok) {
          const loaded = await loadActiveOfferWorkspace(leadId);
          offerIdRef.current = loaded.offerId;
          stateVersionRef.current = loaded.stateVersion;
          setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
          if (loaded.snapshot) {
            hydrateSnapshot(loaded.snapshot);
            lastSavedRef.current = JSON.stringify(loaded.snapshot);
          } else {
            lastSavedRef.current = JSON.stringify(snapshotRef.current);
          }
        }
      } finally {
        setRevising(false);
      }
    })();
  }, [leadId, hydrateSnapshot]);

  // Email the proposal PDF to the client. Flushes the latest edits first so the
  // generated PDF matches the workspace, then routes through sendOfferDocument.
  const sendOffer = useCallback(
    (recipientEmail: string) => {
      const offerId = offerIdRef.current;
      if (leadId === undefined || offerId === null) {
        setSendError("Save the offer against a lead before sending.");
        return;
      }
      setSending(true);
      setSendError(null);
      setSentInfo(null);
      void (async () => {
        try {
          const currentJson = JSON.stringify(snapshotRef.current);
          if (currentJson !== lastSavedRef.current) {
            const saved = await saveOfferWorkspace({
              offerId,
              expectedStateVersion: stateVersionRef.current,
              snapshot: snapshotRef.current,
            });
            if (saved.ok) {
              stateVersionRef.current = saved.stateVersion;
              lastSavedRef.current = currentJson;
            }
          }
          const result = await sendOfferDocument({ offerId, recipientEmail });
          if (result.ok) {
            setStatus("sent");
            setSentInfo(`Sent ${result.reference} to ${recipientEmail}.`);
          } else {
            setSendError(result.error);
          }
        } finally {
          setSending(false);
        }
      })();
    },
    [leadId],
  );

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
        const currentJson = JSON.stringify(snapshotRef.current);
        if (currentJson !== lastSavedRef.current) {
          const saved = await saveOfferWorkspace({
            offerId,
            expectedStateVersion: stateVersionRef.current,
            snapshot: snapshotRef.current,
          });
          if (saved.ok) {
            stateVersionRef.current = saved.stateVersion;
            lastSavedRef.current = currentJson;
          }
        }
        const result = await sendTenderForSignature({ offerId });
        if (result.ok) {
          setStatus("tender_sent");
        } else {
          setTenderSendError(result.error);
        }
      } finally {
        setTenderSending(false);
      }
    })();
  }, [leadId, transition]);

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
        const result = await sendContractForSignature({ offerId });
        if (result.ok) {
          setStatus("contract_sent");
        } else {
          setContractSendError(result.error);
        }
      } finally {
        setContractSending(false);
      }
    })();
  }, [leadId, transition]);

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
        }
      } finally {
        setProjectCreating(false);
      }
    })();
  }, [leadId, transition]);

  return (
    <>
      <OfferWorkspaceScreen
        allowances={allowances}
        areaCalculator={areaCalculator}
        customerPrice={customerPrice}
        directTotal={directTotal}
        draft={draft}
        exclusions={exclusions}
        images={images}
        importResult={importResult}
        job={job}
        leadId={leadId}
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
        onImageChange={updateImage}
        onImported={importWorkbook}
        onJobChange={updateJob}
        onLegacyPricingSettingsChange={updateLegacyPricingSettings}
        onLineChange={updateLine}
        onMarkSent={() => transition("sent")}
        onMarkAgreed={() => transition("agreed")}
        onMarkRejected={() => transition("rejected")}
        onCreateRevision={createRevision}
        canRevise={leadId !== undefined}
        revising={revising}
        onSendOffer={sendOffer}
        canSend={leadId !== undefined}
        sending={sending}
        sendError={sendError}
        sentInfo={sentInfo}
        onGenerateTender={() => transition("tender_draft")}
        onSendTender={sendTender}
        tenderSending={tenderSending}
        tenderSendError={tenderSendError}
        onRecallTender={() => transition("tender_draft")}
        onMarkTenderSigned={() => transition("tender_signed")}
        onGenerateContract={() => transition("contract_draft")}
        onSendContract={sendContract}
        contractSending={contractSending}
        contractSendError={contractSendError}
        onRecallContract={() => transition("contract_draft")}
        onMarkContractSigned={() => transition("contract_signed")}
        onCreateProject={createProject}
        projectCreating={projectCreating}
        projectResult={projectResult}
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
