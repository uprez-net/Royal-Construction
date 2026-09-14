"use server";

import { auth } from "@clerk/nextjs/server";
import { syncLeadStageForOffer } from "@/lib/data/sync-lead-stage";
import { revalidateTag } from "next/cache";
import { EnvelopeStatus, OfferStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { CACHE_PROFILES } from "@/types/cache";
import { getUserByClerkId } from "@/lib/data/user";
import { assertCanAccessLead } from "@/lib/offer/access";
import { createProjectWithLead } from "@/lib/data/projectsWrite";
import { archiveExecuted } from "@/lib/docusign/archive-executed";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import {
  buildHandoffCommercials,
  describeMissingExecutedDocuments,
  tenderExclusionLines,
  type MissingExecutedDocument,
} from "@/lib/offer/project-handoff-commercials";
import {
  resolveContractPaymentSource,
  type ContractPaymentSource,
} from "@/lib/offer/contract-payment-source";
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
      // Each document's latest-sent envelope: the one the Connect webhook treats
      // as current. An older completed envelope was recalled or replaced and
      // is never filed as the executed document.
      tender: {
        select: {
          id: true,
          executedPdfUrl: true,
          documentData: true,
          envelopes: {
            orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { docusignId: true, status: true },
          },
        },
      },
      contract: {
        select: {
          id: true,
          executedPdfUrl: true,
          envelopes: {
            orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { docusignId: true, status: true },
          },
        },
      },
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

  // Both executed PDFs must be on file before a project can be created, rather
  // than creating a project with empty documents (issue #90). The Connect
  // webhook files them once it archives the signed document, but an archive can
  // fail after the signature, so a null URL does not prove the document is
  // unsigned: when DocuSign has the document's latest envelope completed, it is
  // fetched and filed now. Only a document DocuSign has not completed blocks.
  // Runs before the claim below, so a failed gate needs no status rollback.
  const executedTender = await ensureExecutedPdf("tender", offer.tender);
  const executedContract = await ensureExecutedPdf("contract", offer.contract);
  const missingExecutedDocs: MissingExecutedDocument[] = [];
  if (!executedTender.url) {
    missingExecutedDocs.push({ kind: "tender", signed: executedTender.signed });
  }
  if (!executedContract.url) {
    missingExecutedDocs.push({ kind: "contract", signed: executedContract.signed });
  }
  const missingExecutedError = describeMissingExecutedDocuments(missingExecutedDocs);
  if (missingExecutedError) {
    return { ok: false, error: missingExecutedError };
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

  // Normally a no-op — the deal is already WON from CONTRACT_SIGNED — but this
  // is the backstop for an offer that reached PROJECT without the webhook ever
  // firing, which is exactly how leads ended up frozen at "Meeting Scheduled"
  // while their project was already running.
  await syncLeadStageForOffer(offer.id);
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
  // Compensation is itself fallible. Swallowing its errors reported an ordinary
  // "project creation failed" while the offer stayed stuck at PROJECT (no retry
  // possible) or executed-document rows were left orphaned to be duplicated by
  // the next attempt (PR #124 review). Return what actually failed so the caller
  // can say so instead of implying a clean rollback.
  const rollback = async (): Promise<string[]> => {
    const failures: string[] = [];
    try {
      await revertClaim();
    } catch (revertError) {
      console.error("[offer] handoff: status revert failed:", revertError);
      failures.push(
        "the offer is still marked as handed off to a project (status revert failed)",
      );
    }
    if (createdFileIds.length > 0) {
      try {
        await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
      } catch (deleteError) {
        console.error("[offer] handoff: file cleanup failed:", deleteError);
        failures.push(
          "the executed Tender/Contract file rows could not be cleaned up (a retry may duplicate them)",
        );
      }
    }
    return failures;
  };

  // Compose the caller-facing error, appending anything the compensation itself
  // failed to undo so a half-rolled-back handoff is never reported as a clean one.
  const failedWith = (message: string, rollbackFailures: string[]): string =>
    rollbackFailures.length === 0
      ? message
      : `${message}. Additionally, the cleanup did not fully succeed: ${rollbackFailures.join("; ")}. Manual reconciliation is needed before retrying.`;

  const warnings: string[] = [];

  // Everything up to and including project creation is REVERTABLE *only while no
  // Project has been committed*. The commit boundary is INSIDE
  // createProjectWithLead — it commits its transaction and then does a post-commit
  // detail read that can itself throw ("Project was created but could not be
  // retrieved"). So a thrown error does NOT prove the project is absent, and the
  // catch below must ASK the database rather than assume (PR #124 review): if a
  // project now exists for this lead, rolling back would strand a live project on
  // an offer that claims none — and `offer.lead.project` would block every retry.
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
        const rollbackFailures = await rollback();
        return {
          ok: false,
          error: failedWith(
            "The lead has no valid email and the offer has no client email — set one before creating the project",
            rollbackFailures,
          ),
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
      tender: await docRef(executedTender.url, "tender"),
      contract: await docRef(executedContract.url, "contract"),
    };

    // Payment stages and deposit from the signed Tender, the same source the
    // Contract was sent with; the price stays the agreed snapshot's.
    const payment = resolveContractPaymentSource({
      tenderDocumentData: offer.tender?.documentData ?? null,
      agreedPaymentSchedule: snapshot.paymentSchedule,
    });
    if (payment.source === "agreed-snapshot") {
      console.warn(
        `[offer] handoff for offer ${offer.id}: no payment schedule on the Tender row, using the agreed snapshot's`,
      );
    } else {
      console.info(
        `[offer] handoff for offer ${offer.id}: payment stages from the signed Tender (${payment.source})`,
      );
    }

    const extraction = buildExtractionPayload(
      snapshot,
      contractValue,
      reference,
      sourceDocuments,
      payment,
    );

    // The start date defaults to +14 days from today; the signed date written
    // by buildExtractionPayload is today's date. The start is therefore always
    // after the signed date, so the date-pair reconciliation inside
    // createProjectWithLead passes for this path. pcaInspector stays null —
    // the resulting `warn` entry surfaces the project as NEEDS_ATTENTION
    // rather than creating a silent gap on an Active project.
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
      costLines: snapshot.lines,
    });
    handoff = {
      projectId: (project as { id: string }).id,
      projectName: extraction.projectName,
      milestoneCount: project.milestones.length,
    };
  } catch (error) {
    // Did a Project actually commit before the throw? createProjectWithLead's
    // transaction commits before its detail read, so "it threw" and "no project
    // exists" are NOT the same thing. Ask the database instead of assuming.
    //
    // Three outcomes, and they must stay DISTINCT: a swallowed query error that
    // collapsed into "no project" would let a DB blip trigger the destructive
    // rollback — and a DB blip is the most likely reason the original call threw,
    // so the verification query is exactly when it's likeliest to fail too. Only a
    // SUCCESSFUL query that returns project: null proves the rollback is safe.
    let committed: { project: { id: string; name: string } | null } | null = null;
    let verificationFailed = false;
    try {
      committed = await prisma.lead.findUnique({
        where: { id: offer.lead.id },
        select: { project: { select: { id: true, name: true } } },
      });
    } catch (verifyError) {
      verificationFailed = true;
      console.error(
        "[offer] handoff: could not verify whether a project committed:",
        verifyError,
      );
    }

    if (verificationFailed || committed === null) {
      // We cannot PROVE the project is absent (query failed, or the lead row
      // itself couldn't be read). Never destroy data on an unproven assumption:
      // leave the PROJECT claim and the executed-PDF rows intact and ask for
      // manual reconciliation. Worst case a retry is blocked until someone looks;
      // the alternative is deleting a live project's documents.
      return {
        ok: false,
        error: `Project creation failed (${(error as Error).message}) and the result could not be verified. The offer has been left as-is to avoid discarding a project that may have been created — check the lead for a project before retrying.`,
      };
    }

    if (committed.project) {
      // The project IS real — never roll back (that would delete its executed-PDF
      // rows and revert the offer to CONTRACT_SIGNED, with `lead.project` then
      // blocking every retry). Keep the PROJECT claim and report success, flagging
      // that the post-commit detail read failed so the caller can refresh.
      console.error(
        "[offer] handoff: project committed but post-commit step failed:",
        error,
      );
      warnings.push(
        `The project was created, but loading its details failed (${(error as Error).message}). Refresh to see it.`,
      );
      handoff = {
        projectId: committed.project.id,
        projectName: committed.project.name,
        // Unknown here — the detail read is what failed. The caller shows the
        // project itself after a refresh.
        milestoneCount: 0,
      };
      // Fall through to the post-commit block so the audit event + cache
      // invalidation still run for this (genuinely created) project.
    } else {
      // CONFIRMED absent: the query succeeded and the lead has no project. Only
      // now is it safe to revert the claim and delete the executed-PDF rows, so
      // the handoff is cleanly retryable.
      const rollbackFailures = await rollback();
      return {
        ok: false,
        error: failedWith(
          `Project creation failed: ${(error as Error).message}`,
          rollbackFailures,
        ),
      };
    }
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

// The executed PDF for one document: the filed URL, or one fetched from
// DocuSign now when the document's latest envelope completed but its archive
// failed. `signed` says whether DocuSign completed it, which decides what the
// estimator is told when no URL comes back. Not exported: this file is
// "use server", and the caller has already authorized.
async function ensureExecutedPdf(
  kind: "tender" | "contract",
  parent: {
    id: string;
    executedPdfUrl: string | null;
    envelopes: { docusignId: string | null; status: EnvelopeStatus }[];
  } | null,
): Promise<{ url: string | null; signed: boolean }> {
  if (!parent) {
    return { url: null, signed: false };
  }
  if (parent.executedPdfUrl) {
    return { url: parent.executedPdfUrl, signed: true };
  }
  const latest = parent.envelopes[0];
  if (!latest?.docusignId || latest.status !== EnvelopeStatus.COMPLETED) {
    return { url: null, signed: false };
  }
  try {
    const url = await archiveExecuted({ kind, id: parent.id }, latest.docusignId);
    return { url, signed: true };
  } catch (error) {
    console.error(
      `[offer] handoff: fetching the executed ${kind} for envelope ${latest.docusignId} failed:`,
      error,
    );
    return { url: null, signed: true };
  }
}

// ─── Snapshot → ProjectRequirementsPayload ───

function buildExtractionPayload(
  snapshot: OfferWorkspaceSnapshot,
  contractValue: number,
  reference: string,
  sourceDocuments: { tender: ProjectSourceDocumentReference; contract: ProjectSourceDocumentReference },
  payment: Pick<ContractPaymentSource, "paymentSchedule" | "deposit">,
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
  // GST and stage amounts to the cent, matching the offer's own GST split and
  // the figures the BC4 contract printed.
  const { gstAmount, paymentStages, depositValue } = buildHandoffCommercials({
    contractValueIncGst: contractValue,
    gstRate: snapshot.workspacePricingSettings.gstRate,
    paymentSchedule: payment.paymentSchedule,
    deposit: payment.deposit,
  });

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
      // Uploaded from the project's Overview tab after handoff, so there is
      // nothing to carry across here.
      hbcfInsuranceNumber: null,
      hbcfInsuranceDocument: null,
    },
    commercialsAndClaims: {
      totalContractSum: contractValue,
      tenderTotalPrice: contractValue,
      contractPrice: contractValue,
      gstIncluded: true,
      gstAmount,
      depositValue,
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
    inclusionsAndExclusions: {
      inclusions: [...snapshot.draft.inclusionHighlights],
      exclusions: tenderExclusionLines(snapshot),
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