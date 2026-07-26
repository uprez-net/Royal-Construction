"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidateTag } from "next/cache";
import { OfferStatus } from "@prisma/client";
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
import { collectOfferSigners } from "@/lib/offer/workspace-model";
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

  // Both executed PDFs must be on file before a project can be created.
  // executedPdfUrl is written only by the DocuSign completion webhook
  // (app/api/docusign/connect/route.ts) after it archives the signed document;
  // a null URL means the offer reached CONTRACT_SIGNED without a genuine
  // completion (e.g. a manual status advance, or a completion webhook rejected
  // at the HMAC gate), so there is no executed tender/contract to attach.
  // Block here rather than creating a project with empty documents (issue #90).
  // Runs before the claim below, so a failed gate needs no status rollback.
  const missingExecutedDocs: string[] = [];
  if (!offer.tender?.executedPdfUrl) missingExecutedDocs.push("tender");
  if (!offer.contract?.executedPdfUrl) missingExecutedDocs.push("contract");
  if (missingExecutedDocs.length > 0) {
    return {
      ok: false,
      error: `Cannot create the project: no executed ${missingExecutedDocs.join(
        " and ",
      )} PDF is on file. Complete signing via DocuSign so the executed document is archived, then try again.`,
    };
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

  // Executed-PDF File rows are created before createProjectWithLead (it needs
  // their ids to re-parent them onto the project), so they live OUTSIDE that
  // call's transaction. If anything up to and including project creation fails,
  // rollback() must delete them alongside the status revert — otherwise they
  // orphan on the lead and a retry creates duplicate attachments (PR #124 review).
  const createdFileIds: string[] = [];
  const rollback = async () => {
    await revertClaim().catch(() => undefined);
    if (createdFileIds.length > 0) {
      await prisma.file
        .deleteMany({ where: { id: { in: createdFileIds } } })
        .catch(() => undefined);
    }
  };

  const warnings: string[] = [];

  // Everything up to and including project creation is REVERTABLE: any failure
  // rolls the status back to CONTRACT_SIGNED and deletes the executed-PDF rows, so
  // the offer is retryable and no orphans remain. Once createProjectWithLead
  // COMMITS, the project is real and we must NEVER revert past that point — a later
  // audit-event or cache failure that reverted would leave a live project on an
  // offer that claims none, permanently un-retryable (PR #124 review). So the
  // post-commit steps below run OUTSIDE this try and are best-effort.
  let handoff: { projectId: string; projectName: string; milestoneCount: number };
  try {
    const snapshot = deserializeWorkspace(parseWorkspaceState(state));
    const job = snapshot.job;
    // Resolve via the same path the Tender/Contract used — a blank override
    // round-trips to "0", so Number(...) would record a $0 contract value.
    const contractValue =
      buildProposalInput(snapshot).customerPrice.selectedContractValueIncGst;
    const reference = `${offer.baseReference}-R${offer.revisionNumber}`;

    // The project's Customer is created from the lead, whose email is validated
    // deep inside the transaction — reconcile it from the offer up front so a
    // blank lead email doesn't fail with a cryptic error. Trim both sides: a valid
    // owner email with surrounding whitespace must not block the handoff (PR #124).
    const leadEmail = offer.lead.email.trim();
    const jobEmail = job.clientEmail.trim();
    if (!EMAIL_RE.test(leadEmail)) {
      if (EMAIL_RE.test(jobEmail)) {
        await prisma.lead.update({
          where: { id: offer.lead.id },
          data: { email: jobEmail },
        });
        warnings.push(`Lead email was blank — set to ${jobEmail} from the offer.`);
      } else {
        await rollback();
        return {
          ok: false,
          error: "The lead has no valid email and the offer has no client email — set one before creating the project.",
        };
      }
    }

    // Attach the executed legal documents as lead files (createProjectWithLead
    // re-parents them onto the project). Track each created id so rollback() can
    // delete it if a later step fails before the project commits.
    const docRef = async (
      url: string | null | undefined,
      kind: "tender" | "contract",
    ): Promise<ProjectSourceDocumentReference> => {
      if (!url) {
        // Unreachable: the executed-PDF gate above guarantees both URLs are
        // present. Kept as a defensive invariant so a future refactor can never
        // silently attach an empty document reference (the root of issue #90). The
        // outer catch rolls back the claim + files so the offer stays retryable.
        throw new Error(`Executed ${kind} PDF unexpectedly missing after gate.`);
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
      createdFileIds.push(file.id);
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

    const project = await createProjectWithLead({
      projectName: extraction.projectName,
      leadId: offer.leadId,
      // The site's lot area, which is what project.lotSize means. This read 0 on
      // every handoff until the Job setup panel grew an input for it — the column
      // was never wrong, it was starved. It lands only in project.lotSize here:
      // createProjectWithLead's `floorAreaM2: lotSize` fallback is skipped because
      // this path always supplies `extraction`, whose own floorAreaM2 is set below.
      lotSize: job.lotAreaSqm,
      startDate: start.toISOString(),
      estimatedEndDate: end.toISOString(),
      address: job.siteAddress,
      // Site council captured on Job setup via /api/address (ADR 0003); falls
      // back to the historical "TBC" placeholder when unknown.
      council: job.siteCouncil.trim() || "TBC",
      siteManagerId: actor.id,
      // Promote the primary owner identity to the Customer so Project screens and
      // notifications show the legal owner, not the original lead contact (codex
      // #7). clientNames/Email/Phone are the derived primary-owner projection.
      customerName: job.clientNames.trim() || null,
      // Trim before validating — readiness + DocuSign trim, so a valid email with
      // surrounding whitespace must not fall back to the lead here (PR #124).
      customerEmail: EMAIL_RE.test(job.clientEmail.trim())
        ? job.clientEmail.trim()
        : null,
      customerPhone: job.clientPhone.trim() || null,
      // Primary owner's Current Location → Customer.address; the full owner set
      // → Project.parties (companies, directors, both addresses, contacts).
      customerAddress: job.currentLocation.trim() || null,
      parties: JSON.parse(JSON.stringify(job.owners ?? [])),
      extraction,
      sourceDocuments,
    });
    handoff = {
      projectId: (project as { id: string }).id,
      projectName: extraction.projectName,
      milestoneCount: project.milestones.length,
    };
  } catch (error) {
    await rollback();
    return {
      ok: false,
      error: `Project creation failed: ${(error as Error).message}`,
    };
  }

  // ── Past this point the project is COMMITTED — never revert. ──
  warnings.push(
    "Start date defaulted to +14 days (9-month duration) and you are the site manager — adjust in the project settings.",
  );

  // Record the PROJECT status event (the status itself was flipped by the atomic
  // claim). BEST-EFFORT: a failure here must NOT roll back a real project (finding
  // #3), so log and continue — the offer stays PROJECT with its project intact.
  await prisma.offerStatusEvent
    .create({
      data: {
        offerId: offer.id,
        fromStatus: OfferStatus.CONTRACT_SIGNED,
        toStatus: OfferStatus.PROJECT,
        actorId: actor.id,
        note: `Project ${handoff.projectId} created from executed contract`,
      },
    })
    .catch((error) =>
      console.error("[offer] handoff audit event failed:", error),
    );

  // Best-effort cache invalidation — also outside the guarded block so it can
  // never trigger a revert of the project that was just created.
  revalidateTag(`offer-${offer.id}`, CACHE_PROFILES.SHORT);
  revalidateTag("projects", CACHE_PROFILES.MEDIUM);
  revalidateTag(`project-${handoff.projectId}`, CACHE_PROFILES.MEDIUM);

  return {
    ok: true,
    projectId: handoff.projectId,
    projectName: handoff.projectName,
    milestoneCount: handoff.milestoneCount,
    schedulesCreated: 0,
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
  // Owner contacts for the project-extraction legalAdministration block, now
  // sourced from owners[] (ADR 0003) — every owner's name, and every signer's
  // email + phone (fixing the owner emails/phones the doc mapping expected but
  // the old splitOwners path never carried). Falls back to the flat projection.
  const ownerParties = job.owners ?? [];
  const signers = collectOfferSigners(ownerParties);
  const ownerNames = ownerParties
    .map((owner) => owner.displayName.trim())
    .filter(Boolean);
  const ownerEmails = Array.from(
    new Set(
      signers
        .map((signer) => signer.signatory.email.trim())
        .filter((email) => EMAIL_RE.test(email)),
    ),
  );
  const ownerPhones = Array.from(
    new Set(
      signers.map((signer) => signer.signatory.phone.trim()).filter(Boolean),
    ),
  );
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
        names:
          ownerNames.length > 0
            ? ownerNames
            : job.clientNames
              ? [job.clientNames]
              : [],
        emails:
          ownerEmails.length > 0
            ? ownerEmails
            : EMAIL_RE.test(job.clientEmail)
              ? [job.clientEmail]
              : [],
        phones: ownerPhones,
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