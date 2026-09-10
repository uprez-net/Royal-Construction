"use server";

import {
  ComplianceAlertSource,
  ComplianceAlertType,
  ComplianceApprovalChannel,
  ComplianceApprovalDecision,
  ComplianceDocumentType,
  CompliancePartyType,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  complianceDocumentLabel,
  DEVELOPER_APPROVAL_DOCUMENT,
  PARTY_LABEL,
} from "@/constants/complianceDocuments";
import { developerByKey } from "@/constants/complianceDevelopers";
import { requireComplianceAccess } from "@/lib/compliance/access";
import { notifyCompliance } from "@/lib/compliance/notify";
import {
  escapeEmailHtml,
  resolveExtraAttachments,
  sendOnPartyThread,
} from "@/lib/compliance/party-mail";
import {
  raiseComplianceAlert,
  resolveComplianceAlertBySystem,
} from "@/lib/data/compliance-alerts";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  outreachForParty,
  type CertifierEngagementDetail,
  type ComplianceOutreachDetail,
} from "@/types/compliance";
import { logAction } from "./actionLog";

/**
 * The estate developer's sign-off on the bushfire report.
 *
 * A module of its own beside compliance-architect.ts, and a sibling of it in
 * every sense: one party, one loop, three verbs. The architect's loop is
 * meet -> draw -> revise; this one is ask -> decide -> re-issue, and they are
 * the same shape because they are the same problem — somebody outside has to
 * look at work and say whether it will do.
 *
 * What is genuinely different is the direction. Every other party on a
 * compliance file is asked to produce a document and answers with one. A
 * developer is asked about a document somebody else produced, and answers with
 * a verdict — which is why the answer is columns on the outreach rather than a
 * file on a row, and why a rejection has somewhere to go: back to the
 * consultant who wrote the report, in the developer's own words.
 */

/**
 * Runs a follow-on now, or after the response.
 *
 * `after()` schedules work against the request that is being served. Two of the
 * functions below are also reached from `"use step"` workflow steps, which have
 * no request scope — so the callbacks they scheduled could be dropped, and a
 * developer verdict read off an inbound reply landed with no cache
 * revalidation, no activity entry and no notification. Nothing failed; the
 * decision was simply invisible until something else revalidated the project.
 *
 * So a caller that is not serving a request awaits the work instead. The step
 * is already asynchronous and already retried as a unit, which is the better
 * place for it: a follow-on that throws fails the step rather than disappearing
 * into a queue nobody reads.
 */
async function runFollowOn(
  inRequest: boolean,
  work: () => Promise<void> | void,
): Promise<void> {
  if (inRequest) {
    after(work);
    return;
  }
  await work();
}

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`compliance-${projectId}`, CACHE_PROFILES.SHORT);
}

async function requireEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
  if (!engagement) {
    throw new Error("This project has no compliance file yet.");
  }
  return engagement;
}

/**
 * The developer outreach on this file, or a refusal.
 *
 * Throws rather than returning null, because every caller here reaches this
 * having already established there is one — the controls are rendered off the
 * row. A missing row at this point is a stale tab or a direct call, and both
 * want the same answer.
 */
function requireDeveloper(
  engagement: CertifierEngagementDetail,
): ComplianceOutreachDetail {
  const developer = outreachForParty(
    engagement,
    CompliancePartyType.DEVELOPER,
  );
  if (!developer) {
    throw new Error(
      "Nobody has been asked to approve the bushfire report on this job.",
    );
  }
  return developer;
}

/** The bushfire report on the file, with its files, or null. */
function bushfireReport(engagement: CertifierEngagementDetail) {
  return (
    engagement.documents.find(
      (document) => document.documentType === DEVELOPER_APPROVAL_DOCUMENT,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Recording the verdict
// ---------------------------------------------------------------------------

/**
 * Records the developer's answer, and acts on it.
 *
 * Two callers with the same effect and different trust. An admin reads the
 * developer's email and presses a button; the inbound workflow reads the same
 * email with a model and calls this with `channel: INBOUND_EMAIL`. The result
 * is identical because it has to be — a job whose developer replied "approved"
 * must not be in a different state depending on whether anybody was watching.
 *
 * The one asymmetry is which wins. An admin decision overwrites a parsed one,
 * and a parsed one never overwrites an admin decision: a person who has read
 * the thread and pressed the button knows something the extraction does not,
 * and a later automated pass re-reading the same message must not undo them.
 * That is the whole of `channel`.
 *
 * A rejection is not terminal. It clears back to undecided when the consultant
 * re-issues the report, because it is the same approval being sought again on
 * the same thread — see `openBushfireRevision` below, which is what carries the
 * developer's reasons to whoever has to act on them.
 */
export async function recordDeveloperDecision(params: {
  projectId: string;
  decision: ComplianceApprovalDecision;
  /**
   * Why, in the developer's words.
   *
   * Required on a rejection and ignored on an approval. It is not a note: it is
   * quoted verbatim into the mail that goes back to the bushfire consultant,
   * because "the developer said no" is not something anybody can act on, and a
   * consultant redoing a report needs the objection as it was written.
   */
  reason?: string | null;
  channel: ComplianceApprovalChannel;
  /** The admin who pressed the button. Null for a decision read off a reply. */
  decidedById?: string | null;
  decidedByName?: string | null;
}): Promise<CertifierEngagementDetail> {
  // The admin path only. Next treats every export of a `"use server"` module as
  // a Server Function, so the route handler that fronts this is not the access
  // boundary it looks like — without this, a caller who can reach the action
  // endpoint can record a covenant verdict on any project with a compliance
  // file, on a gate the dialog itself says cannot be undone from the screen.
  //
  // Deliberately not applied to the inbound workflow, which reaches this with
  // `channel: INBOUND_EMAIL` from a step that has no signed-in user and is
  // trusted on a different basis — the correlation token on the thread. An
  // interactive check there would throw on every developer reply we parse.
  const fromAdmin = params.channel === ComplianceApprovalChannel.ADMIN;
  if (fromAdmin) {
    await requireComplianceAccess(params.projectId);
  }

  const engagement = await requireEngagement(params.projectId);
  const developer = requireDeveloper(engagement);

  const rejecting =
    params.decision === ComplianceApprovalDecision.REJECTED;
  const reason = params.reason?.trim() || null;

  if (rejecting && !reason) {
    throw new Error(
      "A rejection needs the developer's reasons — they are what the bushfire consultant is sent.",
    );
  }

  // A person's decision stands against a later automated read of the same
  // thread. The reverse is not true: an admin correcting what the extraction
  // concluded is exactly what the button is for.
  if (
    params.channel === ComplianceApprovalChannel.INBOUND_EMAIL &&
    developer.approvalChannel === ComplianceApprovalChannel.ADMIN
  ) {
    return engagement;
  }

  await prisma.complianceOutreach.update({
    where: { id: developer.id },
    data: {
      approvalDecision: params.decision,
      approvalDecidedAt: new Date(),
      approvalChannel: params.channel,
      approvalReason: rejecting ? reason : null,
      approvalDecidedById: params.decidedById ?? null,
    },
  });

  // Either answer ends the wait on them. The report being rejected is still the
  // developer having answered, and leaving the alert open would chase somebody
  // who has already replied while the job waits on a consultant instead.
  await resolveComplianceAlertBySystem({
    projectId: params.projectId,
    engagementId: engagement.id,
    type: ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
    resolutionNote: rejecting
      ? "The developer rejected the report."
      : "The developer approved the report.",
  });

  if (rejecting && reason) {
    // Sent inside the same call rather than left to a second click, because the
    // rejection and the rework are one act: a file that has recorded a refusal
    // and not passed it on is a fortnight of nobody doing anything, and the
    // reasons are already in hand.
    await openBushfireRevision({
      projectId: params.projectId,
      engagement,
      reason,
    });
  }

  // After every write, not before them. On the admin path `after()` defers past
  // the response either way, but the workflow path awaits `runFollowOn` where it
  // stands -- so revalidating up front cleared the cache before the verdict, the
  // alert and the revision were written, and any read landing in that window
  // repopulated it with the state from before the decision and left nothing to
  // invalidate it again.
  await runFollowOn(fromAdmin, async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceDeveloperDecision", {
        projectId: params.projectId,
        engagementId: engagement.id,
        outreachId: developer.id,
        decision: params.decision,
        channel: params.channel,
        reason,
        decidedBy: params.decidedByName ?? null,
        estate: developerByKey(developer.developerKey)?.estate ?? null,
      }),
    );
    await notifyCompliance("complianceDeveloperDecision", params.projectId, {
      decision: params.decision,
      reason: reason ?? "",
      estate: developerByKey(developer.developerKey)?.estate ?? "",
    });
  });

  return requireEngagement(params.projectId);
}

// ---------------------------------------------------------------------------
// Sending the rejection on
// ---------------------------------------------------------------------------

/**
 * Opens a revision round on the bushfire consultant, in the developer's words.
 *
 * The same shape as `reviewArchitectPlans` refusing a set of plans, and it
 * reuses the same table: a round is written, the words that caused it go out on
 * the thread, and the round stays open until a replacement lands. What
 * BUSHFIRE_REVISION_OVERDUE measures is the gap.
 *
 * Never throws, and that is deliberate at this one call site. The verdict has
 * already been recorded and is already on the screen; a mailbox that is down is
 * not a reason to fail the click that recorded it, because the alternative is
 * an admin who pressed Reject, saw an error, and has no way to tell whether the
 * refusal was stored. The round is written before the mail, so a send that
 * fails leaves a visible, obviously incomplete round rather than nothing.
 */
async function openBushfireRevision(params: {
  projectId: string;
  engagement: CertifierEngagementDetail;
  reason: string;
}): Promise<void> {
  const { engagement, reason } = params;
  const consultant = outreachForParty(
    engagement,
    CompliancePartyType.BUSHFIRE_CONSULTANT,
  );

  if (!consultant) {
    // The report came from somewhere else — the client's own consultant, or
    // their paperwork. There is nobody on this file to send it back to, so the
    // rejection is recorded and the alert says what has to happen next.
    await raiseComplianceAlert({
      projectId: params.projectId,
      engagementId: engagement.id,
      type: ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
      raisedBySource: ComplianceAlertSource.DEVELOPER,
      detail: `The developer rejected the bushfire report and there is no consultant engaged on this file to redo it. Their reasons: ${reason}`,
    });
    return;
  }

  const round = await prisma.compliancePlanRevision.create({
    data: { outreachId: consultant.id, feedback: reason },
  });

  try {
    const report = bushfireReport(engagement);
    await sendOnPartyThread({
      engagement,
      outreach: consultant,
      body: [
        `<p>Hi${consultant.contactName ? ` ${consultant.contactName}` : ""},</p>`,
        `<p>The estate developer has reviewed the bushfire assessment for <strong>${escapeEmailHtml(
          engagement.subjectAddress,
        )}</strong> and has not approved it. This is what they said:</p>`,
        `<blockquote style="margin:0 0 1em;padding:0 0 0 1em;border-left:3px solid #ccc;">${escapeEmailHtml(
          reason,
        )}</blockquote>`,
        "<p>Could you revise the assessment to address that and send the updated report back on this thread? It goes straight back to them once we have it.</p>",
        "<p>Kind regards,<br/>Royal Constructions</p>",
      ].join("\n"),
      // The report they wrote, so the revision is against the copy the
      // developer actually read rather than whichever draft is on their desk.
      attachments: (report?.files ?? []).map((file) => ({
        name: file.filename,
        url: file.url,
      })),
    });
  } catch (error) {
    console.error(
      "Could not send the developer's rejection to the bushfire consultant",
      error,
    );
  }

  // Raised whether or not the mail went, because the wait is real either way
  // and this is the line that tells somebody to check.
  await raiseComplianceAlert({
    projectId: params.projectId,
    engagementId: engagement.id,
    type: ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
    raisedBySource: ComplianceAlertSource.DEVELOPER,
    detail: reason,
  });

  await logAction(
    createActivityLogEntry("complianceBushfireRevisionRequested", {
      projectId: params.projectId,
      engagementId: engagement.id,
      outreachId: consultant.id,
      revisionId: round.id,
      reason,
    }),
  );
}

// ---------------------------------------------------------------------------
// The replacement arriving
// ---------------------------------------------------------------------------

/**
 * Closes the revision round when a revised bushfire report lands.
 *
 * Called from the inbound workflow when the consultant's reply carries one, and
 * from the manual upload path, so a report that arrives by either route ends
 * the same wait.
 *
 * It does not send the replacement on to the developer. That is a click, and
 * deliberately: everything else that leaves this system for a third party is
 * one — the pack, the waste management request, the revision above — because
 * the person sending it is the person who has looked at what arrived. A report
 * that came back unchanged, or that answers a different objection, would
 * otherwise go straight out under our name and buy a second refusal.
 *
 * What it does do is clear the developer's verdict, so the block goes back to
 * offering the send rather than showing a stale rejection against a report that
 * has since been redone.
 */
export async function recordBushfireRevisionArrival(params: {
  projectId: string;
  engagementId: string;
}): Promise<void> {
  const consultant = await prisma.complianceOutreach.findFirst({
    where: {
      engagementId: params.engagementId,
      party: CompliancePartyType.BUSHFIRE_CONSULTANT,
    },
    select: { id: true },
  });

  const closed = consultant
    ? await prisma.compliancePlanRevision.updateMany({
        where: { outreachId: consultant.id, respondedAt: null },
        data: { respondedAt: new Date() },
      })
    : { count: 0 };

  // Cleared only where the developer had actually refused. An approval that
  // stands must survive the consultant re-issuing the report for an unrelated
  // reason, and clearing it would put a job that was through this gate back
  // behind it.
  const cleared = await prisma.complianceOutreach.updateMany({
    where: {
      engagementId: params.engagementId,
      party: CompliancePartyType.DEVELOPER,
      approvalDecision: ComplianceApprovalDecision.REJECTED,
    },
    data: {
      approvalDecision: null,
      approvalDecidedAt: null,
      approvalChannel: null,
      approvalDecidedById: null,
      // The reasons stay. They are what the revised report was written to
      // answer, and the block shows them beside the re-send so whoever presses
      // it can check that it actually has been answered.
    },
  });

  if (closed.count === 0 && cleared.count === 0) {
    return;
  }

  await resolveComplianceAlertBySystem({
    projectId: params.projectId,
    engagementId: params.engagementId,
    type: ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
    resolutionNote: "A revised bushfire report has come back.",
  });

  // Called direct rather than scheduled. Both callers are already outside a
  // request scope -- an inbound workflow step, and the upload path's own
  // `after()` callback -- so scheduling a second one here is either dropped or
  // pointless, and the work is two writes.
  revalidateEngagement(params.projectId);

  await logAction(
    createActivityLogEntry("complianceBushfireRevisionReceived", {
      projectId: params.projectId,
      engagementId: params.engagementId,
    }),
  );
}

// ---------------------------------------------------------------------------
// Putting it back in front of them
// ---------------------------------------------------------------------------

/**
 * Sends the current bushfire report to the developer again.
 *
 * The other half of a rejection loop. The outreach already exists and the
 * thread is already running, so this is a message on it rather than a second
 * engagement — which is also what keeps the whole conversation, refusal and
 * all, in one place a person can read top to bottom.
 *
 * `sentAt` is deliberately not re-stamped. It is the clock the response SLA is
 * measured from and it belongs to the engagement rather than to this message;
 * re-stamping it would mean a job that has been round this loop twice reads as
 * though it were first asked yesterday. What restarts the wait is the alert
 * being raised again by the sweep, off a verdict that is null once more.
 */
export async function resendDeveloperApproval(params: {
  projectId: string;
  note?: string | null;
  extraAttachmentIds?: readonly string[];
  requestedByName?: string | null;
}): Promise<CertifierEngagementDetail> {
  // Reached only from the admin dialog, so the check is unconditional. This
  // sends a real email to an external party under our name; the route handler
  // in front of it is not a boundary a Server Function has to pass through.
  await requireComplianceAccess(params.projectId);

  const engagement = await requireEngagement(params.projectId);
  const developer = requireDeveloper(engagement);

  const report = bushfireReport(engagement);
  if (!report || report.files.length === 0) {
    throw new Error(
      "There is no bushfire report on the file to send them.",
    );
  }

  const extras = await resolveExtraAttachments(
    params.projectId,
    params.extraAttachmentIds ?? [],
  );
  const reportIds = new Set(report.files.map((file) => file.id));

  const note = params.note?.trim() || null;
  const previous = developer.approvalReason?.trim() || null;

  await sendOnPartyThread({
    engagement,
    outreach: developer,
    body: [
      `<p>Hi${developer.contactName ? ` ${developer.contactName}` : ""},</p>`,
      previous
        ? `<p>The bushfire assessment for <strong>${escapeEmailHtml(
            engagement.subjectAddress,
          )}</strong> has been revised to address what you raised:</p><blockquote style="margin:0 0 1em;padding:0 0 0 1em;border-left:3px solid #ccc;">${escapeEmailHtml(
            previous,
          )}</blockquote>`
        : `<p>Here is the bushfire assessment for <strong>${escapeEmailHtml(
            engagement.subjectAddress,
          )}</strong> again.</p>`,
      "<p>The updated report is attached. Could you let us know whether you approve it? If it still does not meet the covenant, please tell us what has to change.</p>",
      note ? `<p>${escapeEmailHtml(note)}</p>` : "",
      "<p>Kind regards,<br/>Royal Constructions</p>",
    ]
      .filter(Boolean)
      .join("\n"),
    attachments: [
      ...report.files.map((file) => ({ name: file.filename, url: file.url })),
      ...extras
        .filter((file) => !reportIds.has(file.id))
        .map((file) => ({ name: file.filename, url: file.url })),
    ],
  });

  // Back to undecided, whatever it was. This is the same question being asked
  // again, and a verdict left over from the last round would show against a
  // report they have not seen.
  await prisma.complianceOutreach.update({
    where: { id: developer.id },
    data: {
      approvalDecision: null,
      approvalDecidedAt: null,
      approvalChannel: null,
      approvalDecidedById: null,
      // Kept, unlike the four above. It is what this send was written to
      // answer, and it is the only record of why the job went round twice.
      lastFollowUpAt: new Date(),
    },
  });

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceDeveloperResent", {
        projectId: params.projectId,
        engagementId: engagement.id,
        outreachId: developer.id,
        attachmentCount: report.files.length + extras.length,
        requestedBy: params.requestedByName ?? null,
      }),
    );
    await notifyCompliance("complianceDeveloperResent", params.projectId, {
      party: PARTY_LABEL[CompliancePartyType.DEVELOPER],
      documentLabel: complianceDocumentLabel(
        ComplianceDocumentType.BUSHFIRE_REPORT,
      ),
    });
  });

  return requireEngagement(params.projectId);
}

/**
 * Records whether this lot needs a developer's approval at all.
 *
 * The one question on the development application gate that nothing can answer
 * for itself. It is a standing fact about the land rather than a condition
 * anybody closes out, which is why it is a column on the engagement and not an
 * alert — "no approval needed on this estate" is an answer the gate has to be
 * able to read, and a resolved alert would be indistinguishable from one nobody
 * ever raised.
 *
 * Answering "no" does not delete a developer outreach that already exists.
 * Somebody correcting a mis-answer must not silently discard a thread that has
 * real messages on it; the gate stops reading the approval, and the thread
 * stays on the file where it can be seen.
 */
export async function setDeveloperApprovalRequired(params: {
  projectId: string;
  required: boolean;
  answeredByName?: string | null;
}): Promise<CertifierEngagementDetail> {
  // Reached only from the admin control. The answer is what holds the
  // development application shut, so an unauthenticated flip of it lodges a pack
  // without a covenanted approval — which comes straight back.
  await requireComplianceAccess(params.projectId);

  const engagement = await requireEngagement(params.projectId);

  after(() => revalidateEngagement(params.projectId));

  await prisma.certifierEngagement.update({
    where: { id: engagement.id },
    data: { developerApprovalRequired: params.required },
  });

  after(async () => {
    await logAction(
      createActivityLogEntry("complianceDeveloperApprovalRequirementSet", {
        projectId: params.projectId,
        engagementId: engagement.id,
        required: params.required,
        answeredBy: params.answeredByName ?? null,
      }),
    );
  });

  return requireEngagement(params.projectId);
}
