import { EnvelopeStatus, type User } from "@prisma/client";
import type { TransactionalDomainDb } from "@/lib/domain/db";
import type { CreateProjectFromLeadInput } from "@/lib/domain/projects/creation";
import { archiveExecuted } from "@/lib/docusign/archive-executed";
import { buildProposalInput } from "@/lib/offer/offer-proposal-input";
import {
  buildHandoffCommercials,
  describeMissingExecutedDocuments,
  resolveSignedTenderExclusions,
  type MissingExecutedDocument,
} from "@/lib/offer/project-handoff-commercials";
import {
  describeLegacyContractScheduleDrift,
  resolveContractPaymentSource,
  type ContractPaymentSource,
} from "@/lib/offer/contract-payment-source";
import {
  deserializeWorkspace,
  parseWorkspaceState,
  type OfferWorkspaceSnapshot,
} from "@/lib/offer/workspace-persistence";
import type { OfferWorkspaceJob } from "@/lib/offer/workspace-model";
import type { ProjectOwnerInput } from "@/lib/domain/projects/owners";
import type {
  ProjectRequirementsPayload,
  ProjectSourceDocumentReference,
} from "@/types/project-flow";
import {
  claimProjectHandoff,
  createHandoffFile,
  deleteHandoffFiles,
  findCommittedHandoffProject,
  prepareProjectHandoff,
  recordProjectHandoff,
  revertProjectHandoffClaim,
  setHandoffLeadEmail,
} from "@/lib/domain/offers/project-handoff";
import { userPrincipal } from "@/lib/domain/principal";
import { isDomainError } from "@/lib/domain/errors";

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

/**
 * What a handoff leaves to its caller: creating the project the way that
 * caller creates projects, and the cache expiry after it.
 *
 * The app goes through createProjectWithLead, which adds the Next caches, the
 * project's Xero contact and the "project created" notification after the
 * commit. Eve calls the same domain command, createProjectFromLead, without
 * those: the Xero contact is created with the project's first claim instead.
 */
export type ProjectHandoffEffects = {
  readonly createProject: (
    input: CreateProjectFromLeadInput,
  ) => Promise<{ projectId: string; milestoneCount: number }>;
  /** The handoff committed. Must not throw. */
  readonly handedOff: (offerId: string, projectId: string) => void;
};

// Moved out of lib/data/offer-project-handoff.ts so the app and Eve run one
// handoff. The caller has already resolved the signed-in user.
//
// Convert a CONTRACT_SIGNED offer into a Project: maps the frozen snapshot
// into the project-extraction payload, creates the project (with template
// milestones) via createProjectWithLead, expands the offer cost lines through
// the building-sequence mappings into TradieSchedule bookings, attaches the
// executed Tender/Contract PDFs, and closes the offer to PROJECT.
export async function handOffOfferToProject(
  actor: User,
  input: { offerId: string },
  db: TransactionalDomainDb,
  effects: ProjectHandoffEffects,
): Promise<ProjectHandoffResult> {
  const principal = userPrincipal(actor);
  let prepared: Awaited<ReturnType<typeof prepareProjectHandoff>>;
  try {
    prepared = await prepareProjectHandoff(principal, input.offerId, db);
  } catch (error) {
    if (isDomainError(error)) return { error: error.message, ok: false };
    throw error;
  }
  const { offer, state } = prepared;

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
    missingExecutedDocs.push({
      kind: "contract",
      signed: executedContract.signed,
    });
  }
  const missingExecutedError =
    describeMissingExecutedDocuments(missingExecutedDocs);
  if (missingExecutedError) {
    return { ok: false, error: missingExecutedError };
  }

  // Atomically claim the handoff: flip CONTRACT_SIGNED → PROJECT in one
  // conditional write so two concurrent calls can't both pass the guards above
  // and each create a project/files. Only the caller that wins the claim
  // proceeds; any failure below rolls the status back so it can be retried.
  if (!(await claimProjectHandoff(offer.id, db))) {
    return {
      ok: false,
      error: "This offer is already being handed off to a project.",
    };
  }

  // Normally a no-op — the deal is already WON from CONTRACT_SIGNED — but this
  // is the backstop for an offer that reached PROJECT without the webhook ever
  // firing, which is exactly how leads ended up frozen at "Meeting Scheduled"
  // while their project was already running.
  const revertClaim = () => revertProjectHandoffClaim(offer.id, db);

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
        await deleteHandoffFiles(createdFileIds, db);
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
  let handoff: {
    projectId: string;
    projectName: string;
    milestoneCount: number;
  };
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
        await setHandoffLeadEmail(offer.lead.id, jobEmail, db);
        warnings.push(
          `Lead email was blank — set to ${jobEmail} from the offer.`,
        );
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
        throw new Error(
          `Executed ${kind} PDF unexpectedly missing after gate.`,
        );
      }
      const fileName = `Executed-${kind === "tender" ? "Tender" : "Contract"}-${reference}.pdf`;
      const file = await createHandoffFile(
        principal,
        { fileName, kind, leadId: offer.lead!.id, url },
        db,
      );
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
    const scheduleDrift = describeLegacyContractScheduleDrift({
      contractDocumentData: offer.contract?.documentData ?? null,
      agreedPaymentSchedule: snapshot.paymentSchedule,
      resolved: payment,
      contractValueIncGst: contractValue,
    });
    if (scheduleDrift) {
      console.warn(`[offer] handoff for offer ${offer.id}: ${scheduleDrift}`);
      warnings.push(scheduleDrift);
    }

    // The exclusions the signed Tender printed. The workspace can still be
    // written after the offer is agreed, so rebuilding them from the snapshot
    // could hand the project a list the customer never signed.
    const signedExclusions = resolveSignedTenderExclusions({
      tenderDocumentData: offer.tender?.documentData ?? null,
      snapshot,
    });
    if (signedExclusions.source === "agreed-snapshot") {
      console.warn(
        `[offer] handoff for offer ${offer.id}: no readable exclusions on the Tender row, using the agreed snapshot's`,
      );
    }
    const extraction = buildExtractionPayload(
      snapshot,
      contractValue,
      reference,
      sourceDocuments,
      payment,
      signedExclusions.lines,
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

    const project = await effects.createProject({
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
      // Every owner who signed becomes a customer on the project, so Project
      // screens, notifications and invoices name the legal owners rather than
      // the original lead contact (codex #7). The full owner set also goes to
      // Project.parties (companies, directors, both addresses, contacts).
      owners: handoffOwners(job),
      parties: JSON.parse(JSON.stringify(job.owners ?? [])),
      extraction,
      sourceDocuments,
      costLines: snapshot.lines,
    });
    handoff = {
      projectId: project.projectId,
      projectName: extraction.projectName,
      milestoneCount: project.milestoneCount,
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
    let committed: { project: { id: string; name: string } | null } | null =
      null;
    let verificationFailed = false;
    try {
      committed = await findCommittedHandoffProject(offer.lead.id, db);
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
  await recordProjectHandoff(
    principal,
    { offerId: offer.id, projectId: handoff.projectId },
    db,
  );

  // Best-effort, and outside the guarded block so it can never trigger a
  // revert of the project that was just created.
  effects.handedOff(offer.id, handoff.projectId);

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
// estimator is told when no URL comes back.
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
    const url = await archiveExecuted(
      { kind, id: parent.id },
      latest.docusignId,
    );
    return { url, signed: true };
  } catch (error) {
    console.error(
      `[offer] handoff: fetching the executed ${kind} for envelope ${latest.docusignId} failed:`,
      error,
    );
    return { url: null, signed: true };
  }
}

// ─── Snapshot → project owners ───

/**
 * One owner per owner party on the offer, in the offer's order, with the
 * party's Current Location as the address. An individual is their own
 * signatory. A company is recorded under its registered name, with the email
 * and phone of ONE director — the first who has both — so a company is never
 * given one director's email and another's phone.
 *
 * Nothing is defaulted: an owner missing a detail reaches the owner rule
 * incomplete and the handoff is refused naming them, rather than creating a
 * customer the office would later invoice at the wrong address.
 *
 * An offer saved before owners[] existed is migrated on read, so the list is
 * not normally empty; if it is, the flat primary projection stands in.
 */
function handoffOwners(job: OfferWorkspaceJob): ProjectOwnerInput[] {
  const owners = job.owners ?? [];
  if (owners.length === 0) {
    return [
      {
        address: job.currentLocation,
        email: job.clientEmail,
        name: job.clientNames,
        phone: job.clientPhone,
      },
    ];
  }

  const phoneOf = (
    signatory: OfferWorkspaceJob["owners"][number]["signatories"][number],
  ) =>
    // The mobile first: it is the number the office actually rings.
    signatory.mobile.trim() || signatory.phone.trim();

  return owners.map((owner) => {
    const contact =
      owner.signatories.find(
        (signatory) =>
          EMAIL_RE.test(signatory.email.trim()) && Boolean(phoneOf(signatory)),
      ) ?? owner.signatories[0];
    return {
      address: owner.currentLocation,
      email: contact?.email ?? "",
      name: owner.displayName,
      phone: contact ? phoneOf(contact) : "",
    };
  });
}

// ─── Snapshot → ProjectRequirementsPayload ───

function buildExtractionPayload(
  snapshot: OfferWorkspaceSnapshot,
  contractValue: number,
  reference: string,
  sourceDocuments: {
    tender: ProjectSourceDocumentReference;
    contract: ProjectSourceDocumentReference;
  },
  payment: Pick<ContractPaymentSource, "paymentSchedule" | "deposit">,
  // Resolved by the caller, which can read the Tender row: the exclusions the
  // SIGNED Tender printed, not whatever the workspace holds now.
  signedExclusions: readonly string[],
): ProjectRequirementsPayload {
  const job = snapshot.job;
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
      // Written by the domain from the same owners `handoffOwners` passes,
      // one entry per owner in every list. The per-signer, de-duplicated
      // lists built here before did not line up with the names: a company
      // with two directors gave two emails for one name.
      ownerContacts: { names: [], emails: [], phones: [] },
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
      concreteSlabClass: null,
      concreteStrengthMpa: null,
      vapourBarrier: null,
      termiteSystem: null,
      sewerConnection: null,
    },
    inclusionsAndExclusions: {
      inclusions: [...snapshot.draft.inclusionHighlights],
      exclusions: [...signedExclusions],
    },
    utilityInfrastructure: {
      electricalPhase: null,
      communicationConduit: null,
      gasConnection: null,
      fridgeWaterPoint: null,
      smartLockBrand: null,
    },
    wetAreaCompliance: {
      waterproofingStandard: null,
      showerScreenType: null,
      tiledNicheCount: null,
      showerCount: null,
      floorToCeilingTiles: null,
      floorWasteType: null,
    },
    safetyAndSiteLogistics: {
      roofGuardrails: null,
      sedimentControl: null,
      scaffoldingSafety: null,
      tradeWaste: null,
      finalCleanStatus: null,
    },
    conflicts: [],
    automationTriggers: {
      orderReminders: true,
      rainDelayCalculations: true,
      noticeCountdowns: true,
    },
  };
}
