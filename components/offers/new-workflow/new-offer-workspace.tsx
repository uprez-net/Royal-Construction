"use client";

import {
  INITIAL_ALLOWANCES,
  INITIAL_COST_LINES,
  INITIAL_EXCLUSIONS,
  INITIAL_OFFER_DRAFT,
  INITIAL_OFFER_JOB,
  DEFAULT_WORKSPACE_PRICING_SETTINGS,
  defaultOfferValidUntil,
  applyTaskMappingToCostLine,
  createOfferScopeItem,
  removeOfferScopeItem,
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
  getAreaBasisTotalSqm,
  offerAreaBasisFromJob,
  type OfferAreaCalculator,
} from "@/lib/offer/workspace-area";
import type { OfferWorkbookImportResult } from "@/lib/offer/workspace-import";
import {
  calculateDirectTotal,
  calculateEffectiveMargin,
  calculateOfferCustomerPrice,
  calculateOfferWorkspacePricing,
  resolveOptionalPriceInput,
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
import {
  generateOfferPrefillFromLead,
  type OfferPrefillResult,
} from "@/lib/data/offer-prefill";
import type { OfferWorkspaceSnapshot } from "@/lib/offer/workspace-persistence";
import {
  collectOfferSendBlockers,
  describeOfferExpiry,
} from "@/lib/offer/offer-readiness";
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
export function NewOfferWorkspace({ leadId }: { readonly leadId?: number }) {
  // Lazy-seed validUntil to now + 30 days (same calendar day on the server pass
  // and hydration, so it matches) so a brand-new offer is never born expired.
  const [job, setJob] = useState<OfferWorkspaceJob>(() => ({
    ...INITIAL_OFFER_JOB,
    validUntil: defaultOfferValidUntil(),
  }));
  const [lines, setLines] =
    useState<readonly OfferWorkspaceCostLine[]>(INITIAL_COST_LINES);
  const [allowances, setAllowances] =
    useState<readonly OfferWorkspaceScopeItem[]>(INITIAL_ALLOWANCES);
  const [exclusions, setExclusions] =
    useState<readonly OfferWorkspaceScopeItem[]>(INITIAL_EXCLUSIONS);
  const [draft, setDraft] = useState<OfferDocumentDraft>(INITIAL_OFFER_DRAFT);
  const [overrideReason, setOverrideReason] = useState("");
  const [selectedPriceInput, setSelectedPriceInput] = useState("");
  const [standardPriceInput, setStandardPriceInput] = useState("");
  const [priceAdjustmentLabel, setPriceAdjustmentLabel] = useState("");
  const [status, setStatus] = useState<OfferWorkspaceStatus>("pending");
  const [areaCalculator, setAreaCalculator] =
    useState<OfferAreaCalculator>(INITIAL_AREA_CALCULATOR);
  const [workspacePricingSettings, setWorkspacePricingSettings] =
    useState<OfferWorkspacePricingSettings>(DEFAULT_WORKSPACE_PRICING_SETTINGS);
  const [importResult, setImportResult] =
    useState<OfferWorkbookImportResult | null>(null);
  const [rateCardProduct, setRateCardProduct] =
    useState<RateCardProduct>("DOUBLE_STOREY");
  const [rateCardTier, setRateCardTier] = useState<RateCardTier>("MID");
  const [paymentSchedule, setPaymentSchedule] =
    useState<readonly OfferPaymentScheduleRow[]>(INITIAL_PAYMENT_SCHEDULE);
  const [images, setImages] = useState<OfferImageMap>(EMPTY_OFFER_IMAGES);
  const [revising, setRevising] = useState(false);
  const [revisionNotice, setRevisionNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<string | null>(null);
  const [tenderSending, setTenderSending] = useState(false);
  const [tenderSendError, setTenderSendError] = useState<string | null>(null);
  const [contractSending, setContractSending] = useState(false);
  const [contractSendError, setContractSendError] = useState<string | null>(null);
  const [projectCreating, setProjectCreating] = useState(false);
  const [projectResult, setProjectResult] = useState<ProjectHandoffResult | null>(null);
  const [prefilling, setPrefilling] = useState(false);
  const [prefillResult, setPrefillResult] = useState<OfferPrefillResult | null>(null);
  // Autosave chrome: makes the debounced persistence visible and surfaces a
  // failure instead of swallowing it. "idle" until the first save is attempted.
  const [saveState, setSaveState] =
    useState<"idle" | "saving" | "saved" | "error">("idle");
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

  function updateImage(key: OfferImageSlotKey, image: OfferImage | null) {
    setImages((current) => setOfferImage(current, key, image));
  }

  // Floor areas live on the job (single source of truth); pricing keys off it.
  const totalAreaSqm = useMemo(
    () => getAreaBasisTotalSqm(offerAreaBasisFromJob(job)),
    [job],
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
        sellingContractValueIncGst:
          customerPrice.selectedContractValueIncGst,
        gstRate: workspacePricingSettings.gstRate,
        targetFeePct: workspacePricingSettings.royalConstructionFeePct,
      }),
    [customerPrice, pricing.costBeforeFee, workspacePricingSettings],
  );

  // Offer validity vs. today, and the enumerated blockers standing between this
  // draft and a send. Both feed the header chip and the Send & negotiate strip.
  const offerExpiry = useMemo(
    () => describeOfferExpiry(job.validUntil, now),
    [job.validUntil, now],
  );
  const sendBlockers = useMemo(
    () =>
      collectOfferSendBlockers({
        hasLead: leadId !== undefined,
        needsOverrideReason: customerPrice.needsOverrideReason,
        expiryState: offerExpiry?.state ?? "none",
      }),
    [leadId, customerPrice.needsOverrideReason, offerExpiry],
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
  }

  function updateAreaCalculator(patch: Partial<OfferAreaCalculator>) {
    // Rates/measurements only — floor areas are owned by Job setup.
    setAreaCalculator((current) => ({ ...current, ...patch }));
  }

  function updateWorkspacePricingSettings(
    patch: Partial<OfferWorkspacePricingSettings>,
  ) {
    setWorkspacePricingSettings((current) => ({ ...current, ...patch }));
  }

  function importWorkbook(result: OfferWorkbookImportResult) {
    setImportResult(result);
    setLines(result.costLines);
    setAreaCalculator(result.areaCalculator);
    setWorkspacePricingSettings(result.workspacePricingSettings);
    // Imported floor areas land on the job — the single source of truth.
    setJob((current) => ({
      ...current,
      groundFloorSqm: result.areaBasis.groundFloorSqm,
      firstFloorSqm: result.areaBasis.firstFloorSqm,
      garageSqm: result.areaBasis.garageSqm,
      alfrescoPorchSqm: result.areaBasis.alfrescoSqm,
      porchSqm: result.areaBasis.porchSqm,
      grannyFlatSqm: result.areaBasis.grannyFlatSqm,
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
      let loaded: Awaited<ReturnType<typeof loadActiveOfferWorkspace>>;
      try {
        loaded = await loadActiveOfferWorkspace(leadId);
      } catch (error) {
        // Previously unguarded: a failed load left offerIdRef null, which
        // silently disables autosave — the estimator keeps editing a workspace
        // that can never persist, and only finds out when the tab is closed.
        console.error("[offer] failed to load the workspace:", error);
        if (!cancelled) {
          setSaveState("error");
        }
        return;
      }
      if (cancelled) {
        return;
      }
      offerIdRef.current = loaded.offerId;
      stateVersionRef.current = loaded.stateVersion;
      setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
      // The customer declined the last envelope — tell the operator why (the
      // reason comes straight from DocuSign) and point them at a new revision.
      if (loaded.declineReason) {
        setRevisionNotice(
          `${loaded.declineReason} — create a new version to revise and re-send.`,
        );
      }
      // Show the real minted reference/revision, never the seed default.
      const baseReference = loaded.reference.replace(/-R\d+$/, "");
      const revisionLabel = `R${loaded.revisionNumber}`;
      if (loaded.snapshot) {
        hydrateSnapshot(loaded.snapshot);
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
              setJob((current) => ({ ...current, ...result.job }));
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
  }, [leadId, hydrateSnapshot]);

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
    if (
      status !== "pending" &&
      status !== "sent" &&
      status !== "agreed" &&
      status !== "tender_draft"
    ) {
      return; // frozen once the Tender is sent
    }
    const currentJson = JSON.stringify(snapshot);
    if (currentJson === lastSavedRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        setSaveState("saving");
        try {
          const result = await saveOfferWorkspace({
            offerId,
            expectedStateVersion: stateVersionRef.current,
            snapshot,
          });
          if (result.ok) {
            stateVersionRef.current = result.stateVersion;
            lastSavedRef.current = currentJson;
            setSaveState("saved");
          } else if (
            result.reason === "stale" ||
            result.reason === "superseded"
          ) {
            // Another writer moved on — reload the server copy. Report it as an
            // error state so the operator knows their unsaved edits were
            // reconciled to the newer version (rather than silently clobbered).
            // "superseded" means this tab was editing a revision that another
            // tab has since forked; the same reload lands us on the live one.
            const loaded = await loadActiveOfferWorkspace(leadId);
            offerIdRef.current = loaded.offerId;
            stateVersionRef.current = loaded.stateVersion;
            if (loaded.snapshot) {
              hydrateSnapshot(loaded.snapshot);
              lastSavedRef.current = JSON.stringify(loaded.snapshot);
            }
            setSaveState("error");
          } else {
            setSaveState("error");
          }
        } catch (error) {
          // Network/server failure — previously swallowed. Surface it so the
          // operator does not assume their work is saved.
          console.error("[offer] autosave failed:", error);
          setSaveState("error");
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
      if (leadId === undefined || offerId === null) {
        return;
      }
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
            } else if (
              saved.reason === "stale" ||
              saved.reason === "superseded"
            ) {
              // A concurrent save moved on, or this revision was superseded by
              // another tab — reload and abort rather than freezing a stale
              // snapshot at AGREED or transitioning a revision that is history.
              const loaded = await loadActiveOfferWorkspace(leadId);
              offerIdRef.current = loaded.offerId;
              stateVersionRef.current = loaded.stateVersion;
              setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
              if (loaded.snapshot) {
                hydrateSnapshot(loaded.snapshot);
                lastSavedRef.current = JSON.stringify(loaded.snapshot);
              }
              return;
            }
          }
          await transitionOfferStatus({
            offerId,
            toStatus: next.toUpperCase() as OfferStatus,
          });
          // Only advance the UI once the server transition has committed.
          setStatus(next);
        } catch (error) {
          console.error("[offer] status transition failed:", error);
          // Resync the UI to the server's actual state instead of the
          // optimistic target.
          try {
            const loaded = await loadActiveOfferWorkspace(leadId);
            offerIdRef.current = loaded.offerId;
            stateVersionRef.current = loaded.stateVersion;
            setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
            if (loaded.snapshot) {
              hydrateSnapshot(loaded.snapshot);
              lastSavedRef.current = JSON.stringify(loaded.snapshot);
            }
          } catch {
            // Reload failed too — leave the UI as-is.
          }
        }
      })();
    },
    [leadId, hydrateSnapshot],
  );

  // Fork a new active revision (supersedes the current one), then reload the
  // fresh revision into the workspace.
  const createRevision = useCallback(() => {
    const offerId = offerIdRef.current;
    if (leadId === undefined || offerId === null) {
      return;
    }
    setRevising(true);
    setRevisionNotice(null);
    void (async () => {
      try {
        const result = await createOfferRevision({ offerId });
        if (!result.ok) {
          // Only reason today is an executed contract.
          setRevisionNotice(
            "This contract is executed — changes need a contract variation, not a new offer revision.",
          );
          return;
        }
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
      }
    })();
  }, [leadId, hydrateSnapshot]);

  // Email the proposal PDF to the client. Flushes the latest edits first so the
  // generated PDF matches the workspace, then routes through sendOfferDocument.
  const sendOffer = useCallback(
    (recipientEmail: string, secondaryRecipientEmail?: string | null) => {
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
          const result = await sendOfferDocument({
            offerId,
            recipientEmail,
            secondaryRecipientEmail: secondaryRecipientEmail ?? null,
          });
          if (result.ok) {
            setStatus("sent");
            const recipientSummary = secondaryRecipientEmail
              ? `${recipientEmail} and ${secondaryRecipientEmail}`
              : recipientEmail;
            setSentInfo(`Sent ${result.reference} to ${recipientSummary}.`);
          } else {
            setSendError(result.error);
          }
        } catch (error) {
          // A throw (rather than a returned {ok:false}) used to surface nothing
          // at all — no message, just an unhandled rejection — so report it.
          // Then resync status from the server: the send can commit before it
          // fails, and a stale "pending" would leave the Offer-build steps
          // editable against an offer that is already SENT.
          console.error("[offer] send failed:", error);
          setSendError(
            `Failed to send the offer: ${(error as Error).message}`,
          );
          try {
            const loaded = await loadActiveOfferWorkspace(leadId);
            offerIdRef.current = loaded.offerId;
            stateVersionRef.current = loaded.stateVersion;
            setStatus(loaded.status.toLowerCase() as OfferWorkspaceStatus);
          } catch {
            // Reload failed too — leave the UI as-is.
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
      } catch (error) {
        console.error("[offer] tender send failed:", error);
        setTenderSendError(
          `Failed to send the tender: ${(error as Error).message}`,
        );
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
      } catch (error) {
        console.error("[offer] contract send failed:", error);
        setContractSendError(
          `Failed to send the contract: ${(error as Error).message}`,
        );
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
            setJob((current) => ({ ...current, ...result.job }));
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
        sendBlockers={sendBlockers}
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
        onPrefillFromLead={prefillFromLead}
        canPrefill={leadId !== undefined}
        prefilling={prefilling}
        prefillResult={prefillResult}
        onWorkspacePricingSettingsChange={updateWorkspacePricingSettings}
        onLineChange={updateLine}
        onMarkSent={() => transition("sent")}
        canMarkSent={!customerPrice.needsOverrideReason}
        onMarkAgreed={() => transition("agreed")}
        onMarkRejected={() => transition("rejected")}
        onCreateRevision={createRevision}
        canRevise={
          leadId !== undefined &&
          status !== "contract_signed" &&
          status !== "project"
        }
        revising={revising}
        revisionNotice={revisionNotice}
        revisionExecuted={status === "contract_signed" || status === "project"}
        onSendOffer={sendOffer}
        canSend={leadId !== undefined && !customerPrice.needsOverrideReason}
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
