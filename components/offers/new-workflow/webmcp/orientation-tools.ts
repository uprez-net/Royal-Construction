"use client";

import { webMcpError, webMcpJson } from "@/components/webmcp/tool-result";
import type { WebMcpToolConfig } from "@/hooks/use-webmcp-tool";
import type { OfferBuildStep } from "@/lib/offer/offer-editability";
import { collectOfferSendBlockers, describeOfferExpiry } from "@/lib/offer/offer-readiness";
import { buildOfferReview } from "@/lib/offer/offer-review";
import {
    OFFER_BUILD_STEPS,
    OFFER_BUILD_STEP_ANCHOR,
    OFFER_BUILD_STEP_LABEL,
    OFFER_PHASE_UNLOCK_HINT,
    assertSectionWritable,
    sectionLockReason,
} from "@/lib/offer/webmcp-gating";
import { isOfferPhaseUnlocked } from "@/lib/offer/workflow";
import {
    OFFER_STATUS_LABEL,
    collectOwnerIssues,
} from "@/lib/offer/workspace-model";

import type { OfferToolDeps } from "./deps";
import { READABLE_SECTIONS, noArgs, sectionArg } from "./schemas";

/**
 * Orientation and reads for the offer workspace.
 *
 * Nothing here computes completeness or lock state itself. `buildOfferReview`
 * already decides what "complete" means for the review panel, and
 * `webmcp-gating` already decides what "writable" means for the fieldsets, so
 * both are read rather than re-derived — an agent told a section is complete
 * when the panel says otherwise is worse than an agent told nothing.
 */

type Section = (typeof READABLE_SECTIONS)[number];

/** The later sections, which have no tools yet. Ordered as the workspace shows them. */
const LATER_SECTIONS = [
    { id: "send", index: 6, title: "Send & negotiate", phase: null },
    { id: "tender-access", index: 7, title: "Tender access", phase: "tender" },
    { id: "tender", index: 8, title: "Tender", phase: "tender" },
    { id: "contract", index: 9, title: "Contract", phase: "contract" },
    { id: "project", index: 10, title: "Project", phase: "handoff" },
] as const;

const NO_TOOLS_YET =
    "This section has no tools. Everything it does is outbound or a status change, so a person performs it.";

function readSection(input: Record<string, unknown>): Section | null {
    const raw = typeof input.section === "string" ? input.section.trim() : "";
    return (READABLE_SECTIONS as readonly string[]).includes(raw) ? (raw as Section) : null;
}

const unknownSection = (value: unknown) =>
    webMcpError(
        `Unknown section "${String(value)}". Available: ${READABLE_SECTIONS.join(", ")}.`,
    );

export function createOrientationTools(deps: OfferToolDeps): WebMcpToolConfig[] {
    /** The review, keyed by build step, so a section lookup is one map read. */
    const reviewByStep = () => {
        const review = buildOfferReview({
            job: deps.job,
            lines: deps.lines,
            allowances: deps.allowances,
            exclusions: deps.exclusions,
            draft: deps.draft,
            customerPrice: deps.customerPrice,
        });
        return new Map(review.map((entry) => [entry.id as OfferBuildStep, entry]));
    };

    const buildStepState = (step: OfferBuildStep) => {
        const entry = reviewByStep().get(step);
        const lockReason = sectionLockReason(step, deps.status);
        return {
            section: step,
            index: OFFER_BUILD_STEPS.indexOf(step) + 1,
            title: OFFER_BUILD_STEP_LABEL[step],
            anchorId: OFFER_BUILD_STEP_ANCHOR[step],
            unlocked: true,
            writable: lockReason === null,
            complete: entry?.status === "complete",
            blockers: entry?.issues ?? [],
            summary: entry?.rows ?? [],
            ...(lockReason ? { lockedBecause: lockReason } : {}),
        };
    };

    const laterSectionState = (later: (typeof LATER_SECTIONS)[number]) => {
        // Send & negotiate is never phase-locked; it is where the offer is
        // issued from. The rest gate on the phase ladder.
        const unlocked =
            later.phase === null
                ? true
                : isOfferPhaseUnlocked(deps.status, later.phase);
        return {
            section: later.id,
            index: later.index,
            title: later.title,
            anchorId: `offer-step-${later.id === "tender-access" ? "tender-gate" : later.id}`,
            unlocked,
            writable: false,
            reason: NO_TOOLS_YET,
            ...(unlocked || later.phase === null
                ? {}
                : { unlockCondition: OFFER_PHASE_UNLOCK_HINT[later.phase] }),
        };
    };

    return [
        {
            name: "get_offer_workspace_state",
            title: "Read the offer workspace state",
            description:
                "Your first call in an offer workspace. Returns the offer's status and revision, and all ten sections with whether each is unlocked, writable and complete, plus what is still missing from it. Sections freeze at different points in the lifecycle, so read this before assuming a write will be accepted.",
            inputSchema: noArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: true },
            execute: async () =>
                webMcpJson({
                    leadId: deps.leadId ?? null,
                    reference: deps.reference,
                    revision: deps.revision,
                    status: deps.status,
                    statusLabel: OFFER_STATUS_LABEL[deps.status],
                    stateVersion: deps.stateVersion,
                    saveState: deps.saveState,
                    sections: [
                        ...OFFER_BUILD_STEPS.map(buildStepState),
                        ...LATER_SECTIONS.map(laterSectionState),
                    ],
                }),
        },
        {
            name: "get_offer_section_data",
            title: "Read one offer section",
            description:
                "Returns one section's current values, with an editable flag on every field and the upstream input named for values that are calculated. Use get_cost_schedule and get_pricing_summary instead for those two — they are large enough to warrant their own reads.",
            inputSchema: sectionArg as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: true },
            execute: async (input) => {
                const section = readSection(input);
                if (!section) return unknownSection(input.section);

                switch (section) {
                    case "job-setup": {
                        const { job } = deps;
                        return webMcpJson({
                            ...buildStepState("job-setup"),
                            editable: {
                                buildType: job.buildType,
                                facade: job.facade,
                                siteAddress: job.siteAddress,
                                siteCouncil: job.siteCouncil,
                                lotAreaSqm: job.lotAreaSqm,
                                dpNumber: job.dpNumber,
                                zoning: job.zoning,
                                validUntil: job.validUntil,
                                preparedBy: job.preparedBy,
                                buildScope: job.buildScope,
                                floorAreas: {
                                    groundFloorSqm: job.groundFloorSqm,
                                    firstFloorSqm: job.firstFloorSqm,
                                    voidSqm: job.voidSqm,
                                    garageSqm: job.garageSqm,
                                    alfrescoPorchSqm: job.alfrescoPorchSqm,
                                    porchSqm: job.porchSqm,
                                    balconySqm: job.balconySqm,
                                    grannyFlatSqm: job.grannyFlatSqm,
                                },
                                rooms: {
                                    bedrooms: job.bedrooms,
                                    bathrooms: job.bathrooms,
                                    garageSpaces: job.garageSpaces,
                                },
                            },
                            // Owners are edited as a list in the UI and projected
                            // onto the flat fields. There is no tool for them yet,
                            // so they are reported read-only rather than offered.
                            readOnly: {
                                owners: job.owners ?? [],
                                ownerIssues: collectOwnerIssues(job.owners ?? []),
                                clientNames: job.clientNames,
                                clientEmail: job.clientEmail,
                                currentLocation: job.currentLocation,
                                totalAreaSqm: deps.totalAreaSqm,
                            },
                            derivedFrom: {
                                clientNames: "the owners list",
                                clientEmail: "the owners list",
                                currentLocation: "the owners list",
                                totalAreaSqm: "the floor areas",
                            },
                            note: "Owner and signatory details are edited in the UI's Owners panel; no tool writes them. Everything under readOnly is projected from owners or the floor areas.",
                        });
                    }
                    case "cost-schedule":
                        return webMcpJson({
                            ...buildStepState("cost-schedule"),
                            note: "Call get_cost_schedule for the rows.",
                            rowCount: deps.lines.length,
                            pricedRowCount: deps.lines.filter((line) => line.costExGst > 0).length,
                            directTotal: deps.directTotal,
                        });
                    case "pricing":
                        return webMcpJson({
                            ...buildStepState("pricing"),
                            note: "Call get_pricing_summary for the build-up.",
                        });
                    case "scope":
                        return webMcpJson({
                            ...buildStepState("scope"),
                            allowances: deps.allowances,
                            exclusions: deps.exclusions,
                            note: "Every field on an item is editable with update_scope_item. includedInOfferDocument controls whether it prints for the customer.",
                        });
                    case "offer-document": {
                        const { draft } = deps;
                        return webMcpJson({
                            ...buildStepState("offer-document"),
                            editable: {
                                headline: draft.headline,
                                introText: draft.introText,
                                inclusionHighlights: draft.inclusionHighlights,
                                exclusionBullets: draft.exclusionBullets,
                                termsSummary: draft.termsSummary,
                            },
                            inclusionSchedule: draft.inclusionSchedule.map((entry, index) => ({
                                index,
                                spec: entry.spec,
                                category: entry.category ?? null,
                                // Contract text the model wrote that nobody has
                                // reviewed. Surfaced so it can be flagged before send.
                                draftedByAi: entry.draftedByAi === true,
                            })),
                            note: "inclusionHighlights is the selling list beside the price; inclusionSchedule is the contractual schedule. They are separate lists — changing one does not change the other.",
                        });
                    }
                    default: {
                        const later = LATER_SECTIONS.find((entry) => entry.id === section);
                        return webMcpJson({
                            ...(later ? laterSectionState(later) : {}),
                        });
                    }
                }
            },
        },
        {
            name: "open_offer_section",
            title: "Open an offer section",
            description:
                "Expands a section and scrolls to it, so the user can see where you are working. Does not change any data. Refuses a section the offer's status has frozen, with the reason.",
            inputSchema: sectionArg as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: false },
            execute: async (input) => {
                const section = readSection(input);
                if (!section) return unknownSection(input.section);

                const later = LATER_SECTIONS.find((entry) => entry.id === section);
                if (later) {
                    const state = laterSectionState(later);
                    if (!state.unlocked) {
                        return webMcpError(
                            `${later.title} is locked. ${state.unlockCondition ?? ""}`.trim(),
                        );
                    }
                    // Phase gates are not collapsible; scrolling is all there is.
                    deps.scrollToSection(state.anchorId);
                    return webMcpJson({ opened: true, ...state });
                }

                const step = section as OfferBuildStep;
                const gate = assertSectionWritable(step, deps.status);
                const anchorId = OFFER_BUILD_STEP_ANCHOR[step];
                // A frozen section is still worth showing — the user may want to
                // read it — so this opens it and reports that it is read-only,
                // rather than refusing outright the way a write would.
                deps.setSectionOpen(anchorId, true);
                deps.scrollToSection(anchorId);
                return webMcpJson({
                    opened: true,
                    ...buildStepState(step),
                    ...(gate.ok ? {} : { readOnly: true }),
                });
            },
        },
        {
            name: "get_cost_schedule",
            title: "Read the cost schedule",
            description:
                "Returns the cost workbook: every task line with its value, whether it is included in the contract, and where the value came from. Rows with source \"formula\" recompute from the job's measurements and cannot be given a value directly — change the measurement with update_cost_requirements or update_job_setup instead.",
            inputSchema: noArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: true },
            execute: async () =>
                webMcpJson({
                    ...buildStepState("cost-schedule"),
                    directTotal: deps.directTotal,
                    totalAreaSqm: deps.totalAreaSqm,
                    rows: deps.lines.map((line) => ({
                        id: line.id,
                        stageCode: line.stageCode,
                        itemName: line.itemName,
                        offerTenderLineItem: line.offerTenderLineItem,
                        tradeOrVendor: line.tradeOrVendor,
                        costExGst: line.costExGst,
                        includedInContract: line.includedInContract,
                        buildingSequenceTasks: line.buildingSequenceTasks,
                        source: line.formula
                            ? "formula"
                            : line.sourceReference
                              ? "imported"
                              : "manual",
                        // Only the value is locked on a formula row; its labels
                        // and its inclusion flag are still the estimator's.
                        costEditable: !line.formula,
                        ...(line.formula ? { formula: line.formula } : {}),
                    })),
                    // The area calculator's own inputs, since they are what a
                    // formula row actually resolves from.
                    requirements: deps.areaCalculator,
                    note: "requirements are the area-calculator inputs; every calculated slab, frame, brick and tile output is resolved from them plus the floor areas and the admin rate card, and none of those outputs is writable.",
                }),
        },
        {
            name: "get_pricing_summary",
            title: "Read the pricing build-up",
            description:
                "Returns the offer's price: the four inputs you can change, the calculated build-up from cost base to contract value, and the customer-facing price with any manual override. Everything under calculated is derived — including the HBCF premium — and writing to it is refused.",
            inputSchema: noArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: true },
            execute: async () => {
                const { pricing, pricingSettings: settings, customerPrice } = deps;
                return webMcpJson({
                    ...buildStepState("pricing"),
                    editable: {
                        royalConstructionOverheadPct: settings.royalConstructionOverheadPct,
                        royalConstructionFeePct: settings.royalConstructionFeePct,
                        hbcfTotalContractValue: settings.hbcfTotalContractValue,
                        impactFeeFixed: settings.impactFeeFixed,
                    },
                    calculated: {
                        directTotal: pricing.directTotal,
                        additionsTotal: pricing.additionsTotal,
                        costBeforeFee: pricing.costBeforeFee,
                        royalConstructionOverhead: pricing.royalConstructionOverhead,
                        royalConstructionFee: pricing.royalConstructionFee,
                        totalIncludingConstruction: pricing.totalIncludingConstruction,
                        gstAmount: pricing.gstAmount,
                        contractValueIncGst: pricing.contractValueIncGst,
                        perSqm: pricing.perSqm,
                        homeWarrantyHbcfFixed: settings.homeWarrantyHbcfFixed,
                        hbcfRate: settings.hbcfRate,
                        loadingChargePercentage: settings.loadingChargePercentage,
                        gstRate: settings.gstRate,
                    },
                    derivedFrom: {
                        homeWarrantyHbcfFixed:
                            "hbcfTotalContractValue, the HBCF rate and the admin loading charge",
                        directTotal: "the included cost-schedule rows",
                        perSqm: "the contract value and the total floor area",
                    },
                    customerPrice: {
                        computedContractValueIncGst: customerPrice.computedContractValueIncGst,
                        selectedContractValueIncGst: customerPrice.selectedContractValueIncGst,
                        varianceIncGst: customerPrice.varianceIncGst,
                        hasManualOverride: customerPrice.hasManualOverride,
                        needsOverrideReason: customerPrice.needsOverrideReason,
                        overrideReason: deps.overrideReason,
                        standardPrice: deps.standardPriceInput,
                        priceAdjustmentLabel: deps.priceAdjustmentLabel,
                    },
                    effectiveMargin: {
                        effectiveMarkupPct: deps.effectiveMargin.effectiveMarkupPct,
                        marginStatus: deps.effectiveMargin.marginStatus,
                    },
                });
            },
        },
        {
            name: "validate_offer_for_send",
            title: "Check whether the offer is ready to send",
            description:
                "Walks the five build sections and reports everything standing between this offer and an email to the client, split into blockers that stop a send and warnings that do not. Call this before telling the user an offer is ready. It sends nothing.",
            inputSchema: noArgs as unknown as Record<string, unknown>,
            annotations: { readOnlyHint: true },
            execute: async () => {
                const review = buildOfferReview({
                    job: deps.job,
                    lines: deps.lines,
                    allowances: deps.allowances,
                    exclusions: deps.exclusions,
                    draft: deps.draft,
                    customerPrice: deps.customerPrice,
                });
                const expiry = describeOfferExpiry(deps.job.validUntil, new Date());
                const blockers = collectOfferSendBlockers({
                    hasLead: deps.leadId !== undefined,
                    needsOverrideReason: deps.customerPrice.needsOverrideReason,
                    expiryState: expiry.state,
                    ownerIssues: collectOwnerIssues(deps.job.owners ?? []),
                });

                const blocking = blockers.filter((entry) => entry.severity === "block");
                return webMcpJson({
                    status: deps.status,
                    readyToSend: blocking.length === 0,
                    blockers: blocking.map((entry) => ({
                        label: entry.label,
                        section: entry.stepId.replace(/^offer-step-/, ""),
                    })),
                    warnings: blockers
                        .filter((entry) => entry.severity === "warn")
                        .map((entry) => ({
                            label: entry.label,
                            section: entry.stepId.replace(/^offer-step-/, ""),
                        })),
                    expiry: { state: expiry.state, label: expiry.label },
                    sections: review.map((entry) => ({
                        section: entry.id,
                        complete: entry.status === "complete",
                        issues: entry.issues,
                    })),
                    note: "Sending is done by a person from the Send & negotiate step. There is no tool for it.",
                });
            },
        },
    ];
}
