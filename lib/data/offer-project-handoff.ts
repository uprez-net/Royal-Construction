"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { OfferStatus, ProjectStage } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { getUserByClerkId } from "@/lib/data/user";
import { assertCanAccessLead } from "@/lib/offer/access";
import { createProjectWithLead } from "@/lib/data/projectsWrite";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import { splitOwners } from "@/lib/offer/offer-tender-html";
import { getOfferSequenceMappingByTask } from "@/lib/offer/workspace-sequence-mapping";
import type { ProjectRequirementsPayload, ProjectSourceDocumentReference } from "@/types/project-flow";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ProjectHandoffResult =
  | {
      ok: true;
      projectId: string;
      projectName: string;
      milestoneCount: number;
      schedulesCreated: number;
      warnings: string[];
    }
  | { ok: false; error: string };

// Convert a CONTRACT_SIGNED offer into a Project: maps the frozen snapshot
// into the project-extraction payload, creates the project (with template
// milestones) via createProjectWithLead, expands the offer cost lines through
// the building-sequence mappings into TradieSchedule bookings, attaches the
// executed Tender/Contract PDFs, and closes the offer to PROJECT.
export async function createProjectFromOffer(input: {
  offerId: string;
}): Promise<ProjectHandoffResult> {
  const { isAuthenticated, userId: clerkId } = await auth();
  if (!isAuthenticated) {
    return { ok: false, error: "Unauthorized" };
  }
  const actor = clerkId ? await getUserByClerkId(clerkId) : null;
  if (!actor) {
    return { ok: false, error: "No internal user found for the signed-in account." };
  }

  const offer = await prisma.offer.findUnique({
    where: { id: input.offerId },
    select: {
      id: true,
      leadId: true,
      baseReference: true,
      revisionNumber: true,
      offerStatus: true,
      workspaceState: true,
      agreedSnapshot: true,
      tender: { select: { executedPdfUrl: true } },
      contract: { select: { executedPdfUrl: true } },
      lead: { select: { id: true, name: true, email: true, phone: true, project: { select: { id: true } } } },
    },
  });
  if (!offer || !offer.lead) {
    return { ok: false, error: "Offer or its lead not found." };
  }
  try {
    await assertCanAccessLead(actor, offer.leadId);
  } catch {
    return { ok: false, error: "You do not have access to this offer." };
  }
  if (offer.offerStatus === OfferStatus.PROJECT) {
    return { ok: false, error: "A project has already been created from this offer." };
  }
  if (offer.offerStatus !== OfferStatus.CONTRACT_SIGNED) {
    return {
      ok: false,
      error: `The project can only be created once the Contract is signed (current status: ${offer.offerStatus}).`,
    };
  }
  if (offer.lead.project) {
    return {
      ok: false,
      error: `Lead #${offer.lead.id} already has a project (${offer.lead.project.id}).`,
    };
  }
  const state = offer.agreedSnapshot ?? offer.workspaceState;
  if (!state) {
    return { ok: false, error: "No agreed offer snapshot found." };
  }

  // Atomically claim the handoff: flip CONTRACT_SIGNED → PROJECT in one
  // conditional write so two concurrent calls can't both pass the guards above
  // and each create a project/files. Only the caller that wins the claim
  // proceeds; any failure below rolls the status back so it can be retried.
  const claim = await prisma.offer.updateMany({
    where: { id: offer.id, offerStatus: OfferStatus.CONTRACT_SIGNED },
    data: { offerStatus: OfferStatus.PROJECT },
  });
  if (claim.count !== 1) {
    return { ok: false, error: "This offer is already being handed off to a project." };
  }
  const revertClaim = () =>
    prisma.offer.updateMany({
      where: { id: offer.id, offerStatus: OfferStatus.PROJECT },
      data: { offerStatus: OfferStatus.CONTRACT_SIGNED },
    });

  const warnings: string[] = [];
  const snapshot = deserializeWorkspace(parseWorkspaceState(state));
  const job = snapshot.job;
  // Resolve via the same path the Tender/Contract used — a blank override
  // round-trips to "0", so Number(...) would record a $0 contract value.
  const contractValue =
    buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;
  const reference = `${offer.baseReference}-R${offer.revisionNumber}`;

  // The project's Customer is created from the lead, whose email is validated
  // deep inside the transaction — reconcile it from the offer up front so a
  // blank lead email doesn't fail with a cryptic error.
  if (!EMAIL_RE.test(offer.lead.email)) {
    if (EMAIL_RE.test(job.clientEmail)) {
      await prisma.lead.update({
        where: { id: offer.lead.id },
        data: { email: job.clientEmail },
      });
      warnings.push(`Lead email was blank — set to ${job.clientEmail} from the offer.`);
    } else {
      await revertClaim();
      return {
        ok: false,
        error: "The lead has no valid email and the offer has no client email — set one before creating the project.",
      };
    }
  }

  // Attach the executed legal documents as lead files (createProjectWithLead
  // re-parents them onto the project).
  const docRef = async (
    url: string | null | undefined,
    kind: "tender" | "contract",
  ): Promise<ProjectSourceDocumentReference> => {
    if (!url) {
      warnings.push(`No executed ${kind} PDF on file — project created without it.`);
      return { fileId: "", fileName: "", url: "", kind };
    }
    const fileName = `Executed-${kind === "tender" ? "Tender" : "Contract"}-${reference}.pdf`;
    const file = await prisma.file.create({
      data: {
        leadId: offer.lead!.id,
        filename: fileName,
        fileType: "application/pdf",
        filesize: 0,
        url,
        uploadedBy: actor.id,
      },
    });
    return { fileId: file.id, fileName, url, kind };
  };
  const sourceDocuments = {
    tender: await docRef(offer.tender?.executedPdfUrl, "tender"),
    contract: await docRef(offer.contract?.executedPdfUrl, "contract"),
  };

  const extraction = buildExtractionPayload(snapshot, contractValue, reference, sourceDocuments);

  const start = new Date();
  start.setDate(start.getDate() + 14);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 9);

  let projectId: string;
  try {
    const project = await createProjectWithLead({
      projectName: extraction.projectName,
      leadId: offer.leadId,
      lotSize: job.lotAreaSqm ?? 0,
      startDate: start.toISOString(),
      estimatedEndDate: end.toISOString(),
      address: job.siteAddress,
      council: "TBC",
      siteManagerId: actor.id,
      extraction,
      sourceDocuments,
    });
    projectId = (project as { id: string }).id;
  } catch (error) {
    await revertClaim();
    return {
      ok: false,
      error: `Project creation failed: ${(error as Error).message}`,
    };
  }
  warnings.push(
    "Start date defaulted to +14 days (9-month duration) and you are the site manager — adjust in the project settings.",
  );

  // Allocation runs AFTER the project exists; if it throws here it must not
  // abort the handoff, or the offer stays CONTRACT_SIGNED with a project the
  // lead-already-has-a-project guard then refuses to retry. Degrade to a
  // warning and still advance the offer to PROJECT below.
  let allocation: {
    milestoneCount: number;
    schedulesCreated: number;
    warnings: string[];
  };
  try {
    allocation = await allocateTradeSchedules(projectId, snapshot, start);
    warnings.push(...allocation.warnings);
  } catch (error) {
    allocation = { milestoneCount: 0, schedulesCreated: 0, warnings: [] };
    warnings.push(
      `Trade schedules could not be allocated (${(error as Error).message}) — book them manually in the project.`,
    );
  }

  // Status already flipped to PROJECT by the atomic claim above; just record
  // the audit event now that the project exists.
  await prisma.offerStatusEvent.create({
    data: {
      offerId: offer.id,
      fromStatus: offer.offerStatus,
      toStatus: OfferStatus.PROJECT,
      actorId: actor.id,
      note: `Project ${projectId} created from executed contract`,
    },
  });

  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  revalidateTag("projects", CACHE_PROFILES.MEDIUM);
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.MEDIUM);

  return {
    ok: true,
    projectId,
    projectName: extraction.projectName,
    milestoneCount: allocation.milestoneCount,
    schedulesCreated: allocation.schedulesCreated,
    warnings,
  };
}

// ─── Snapshot → ProjectRequirementsPayload ───

function buildExtractionPayload(
  snapshot: OfferWorkspaceSnapshot,
  contractValue: number,
  reference: string,
  sourceDocuments: { tender: ProjectSourceDocumentReference; contract: ProjectSourceDocumentReference },
): ProjectRequirementsPayload {
  const job = snapshot.job;
  const owners = splitOwners(job.clientNames);
  const paymentStages = snapshot.paymentSchedule.map((row) => ({
    label: row.stageName,
    percentage: row.percentOfContract * 100,
    amount: Math.round(contractValue * row.percentOfContract),
  }));
  const depositStage =
    paymentStages.find((s) => s.label.toLowerCase().includes("deposit")) ?? paymentStages[0];

  return {
    version: 1,
    sourceDocuments,
    validations: [],
    projectName: `${job.clientNames} — ${job.siteAddress}`,
    projectType: job.buildType || "Residential build",
    summary: `Fixed-price build at ${job.siteAddress} per executed Contract (Tender ${reference}). ${job.buildScope.join(". ")}`,
    legalAdministration: {
      siteAddress: job.siteAddress,
      ownerContacts: {
        names: owners,
        emails: EMAIL_RE.test(job.clientEmail) ? [job.clientEmail] : [],
        phones: [],
      },
      commencementTrigger: "Executed contract + council/CDC approval",
      signedDate: new Date().toISOString().slice(0, 10),
      pcaInspector: null,
    },
    commercialsAndClaims: {
      totalContractSum: contractValue,
      tenderTotalPrice: contractValue,
      contractPrice: contractValue,
      gstIncluded: true,
      gstAmount: Math.round(contractValue / 11),
      depositValue: depositStage?.amount ?? null,
      claimStageSlabPercentage: null,
      claimStageSlabDollarValue: null,
      variationAdminFee: null,
      latePenaltyRate: null,
      paymentStages,
    },
    subStructureAndGround: {
      concreteSlabClass: null, concreteStrengthMpa: null, vapourBarrier: null,
      termiteSystem: null, sewerConnection: null,
    },
    shellAndExternal: {
      ceilingHeightGroundFloor: null, ceilingHeightFirstFloor: null, roofingMaterial: null,
      brickAllowance: null, brickCount: null, selectedBrickPrice: null, windowProvider: null,
      floorAreaM2: job.groundFloorSqm + job.firstFloorSqm,
    },
    mechanicalDetails: {
      acSystemZones: null, acRequiredCapacityKw: null, acInstalledCapacityKw: null,
      lightingCount: null, tenderLightingCount: null, powerPointCount: null,
      externalPower: null, jointSealants: null,
    },
    internalFitOutAndFinishes: {
      internalDoorHeight: null, skirtingSize: null, stoneThickness: null, waterfallEnds: null,
      tapwareFinish: null, tilesProvisionRate: null, tileAllowance: null,
      selectedTilePrice: null, wetAreaSizeM2: null,
    },
    exclusionsAndRisks: {
      retainingWalls: null, fencing: null, blinds: null, solarProvisions: null,
      rockExcavation: null,
      ownerResponsibility: [...snapshot.draft.exclusionBullets],
      variationRequired: [],
    },
    utilityInfrastructure: {
      electricalPhase: null, communicationConduit: null, gasConnection: null,
      fridgeWaterPoint: null, smartLockBrand: null,
    },
    wetAreaCompliance: {
      waterproofingStandard: null, showerScreenType: null, tiledNicheCount: null,
      showerCount: null, floorToCeilingTiles: null, floorWasteType: null,
    },
    safetyAndSiteLogistics: {
      roofGuardrails: null, sedimentControl: null, scaffoldingSafety: null,
      tradeWaste: null, finalCleanStatus: null,
    },
    conflicts: [],
    automationTriggers: {
      orderReminders: true,
      rainDelayCalculations: true,
      noticeCountdowns: true,
    },
  };
}

// ─── Cost lines → TradieSchedule bookings ───

// Mapping trade names don't always match Tradie.trade verbatim; normalise and
// alias the known mismatches. Extend as the tradie book grows.
const TRADE_ALIASES: Record<string, readonly string[]> = {
  concretor: ["concreting", "concrete"],
  frame: ["carpentry", "framing", "carpenter"],
  "brick layer": ["bricklaying", "brickwork", "bricklayer"],
  sparky: ["electrical", "electrician"],
  electrician: ["electrical"],
  plumber: ["plumbing"],
  tiler: ["tiling"],
  painter: ["painting"],
  roofer: ["roofing"],
  waterproofer: ["waterproofing"],
};

function normaliseTrade(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/booking \d+ of \d+/g, "")
    .trim();
}

function stageForLabel(label: string): ProjectStage {
  const l = label.toLowerCase();
  if (l.includes("deposit")) return ProjectStage.Deposit;
  if (l.includes("slab") || l.includes("base") || l.includes("foundation")) return ProjectStage.Slab;
  if (l.includes("frame")) return ProjectStage.Frame;
  if (l.includes("lock")) return ProjectStage.Lockup;
  if (l.includes("fit") || l.includes("fix") || l.includes("interior")) return ProjectStage.Interior_Fit_Out;
  return ProjectStage.Final;
}

async function allocateTradeSchedules(
  projectId: string,
  snapshot: OfferWorkspaceSnapshot,
  scheduledDate: Date,
): Promise<{ milestoneCount: number; schedulesCreated: number; warnings: string[] }> {
  const warnings: string[] = [];
  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, projectStage: true },
  });
  const milestoneByStage = new Map<ProjectStage, { id: string; name: string }>();
  for (const milestone of milestones) {
    if (!milestoneByStage.has(milestone.projectStage)) {
      milestoneByStage.set(milestone.projectStage, milestone);
    }
  }

  const tradies = await prisma.tradie.findMany({ select: { id: true, name: true, trade: true } });
  const findTradie = (wanted: string) => {
    const w = normaliseTrade(wanted);
    const candidates = [w, ...(TRADE_ALIASES[w] ?? [])];
    for (const candidate of candidates) {
      const match = tradies.find((t) => {
        const trade = t.trade.toLowerCase();
        return trade === candidate || trade.includes(candidate) || candidate.includes(trade);
      });
      if (match) return match;
    }
    return null;
  };

  const planned = new Map<
    string,
    { tradieId: string; milestoneId: string | null }
  >();
  const unmatchedTrades = new Set<string>();
  const unmappedLines: string[] = [];

  for (const line of snapshot.lines) {
    if (!line.includedInContract || !line.itemName) continue;
    const mapping = getOfferSequenceMappingByTask(line.itemName);
    if (!mapping) {
      unmappedLines.push(line.itemName);
      continue;
    }
    const stage = stageForLabel(mapping.milestoneStages[0] ?? "final");
    const milestone = milestoneByStage.get(stage) ?? milestones[milestones.length - 1] ?? null;
    for (const trade of mapping.tradesToBook) {
      const tradie = findTradie(trade);
      if (!tradie) {
        unmatchedTrades.add(trade);
        continue;
      }
      planned.set(`${tradie.id}:${milestone?.id ?? "none"}`, {
        tradieId: tradie.id,
        milestoneId: milestone?.id ?? null,
      });
    }
  }

  let created = 0;
  for (const p of planned.values()) {
    await prisma.tradieSchedule.create({
      data: {
        tradieId: p.tradieId,
        projectId,
        milestoneId: p.milestoneId,
        scheduledDate,
        durationDays: 5,
        requiresQuote: true,
        quotedPrice: null,
      },
    });
    created += 1;
  }

  if (unmatchedTrades.size > 0) {
    warnings.push(`No tradie found for: ${[...unmatchedTrades].join(", ")} — book these manually.`);
  }
  if (unmappedLines.length > 0) {
    warnings.push(`Cost lines without a sequence mapping (no trades booked): ${unmappedLines.join(", ")}.`);
  }

  return { milestoneCount: milestones.length, schedulesCreated: created, warnings };
}
