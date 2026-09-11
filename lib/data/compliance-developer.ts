"use server";

import {
  ComplianceAlertSource,
  ComplianceAlertType,
  ComplianceApprovalChannel,
  ComplianceApprovalDecision,
  ComplianceDocumentType,
  CompliancePartyType,
  EstateDeveloperSource,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  complianceDocumentLabel,
  PARTY_LABEL,
  type DeveloperApprovalDocument,
} from "@/constants/complianceDocuments";
import { readLandDeedDeveloper } from "@/lib/agent/landDeedDeveloperAgent";
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
  developerApprovalFor,
  outreachForParty,
  type CertifierEngagementDetail,
  type ComplianceOutreachDetail,
} from "@/types/compliance";
import { logAction } from "./actionLog";

/**
 * What the wait on each document under covenant is called.
 *
 * Two types rather than one, because at most one alert of a type is open per file
 * and both waits can be live at once — a developer sitting on the plans while the
 * report they were also sent is still outstanding. One shared type meant a job
 * could only ever say one of them out loud, and the chase named whichever document
 * the copy happened to mention.
 *
 * Keyed on the document so the table is exhaustive over
 * `DEVELOPER_APPROVAL_DOCUMENTS`: a third document brought under covenant is a
 * compile error here rather than a wait nothing measures.
 */
const DEVELOPER_WAIT_ALERT: Readonly<
  Record<DeveloperApprovalDocument, ComplianceAlertType>
> = {
  [ComplianceDocumentType.BUSHFIRE_REPORT]:
    ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE,
  [ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN]:
    ComplianceAlertType.DEVELOPER_PLANS_OVERDUE,
};

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
 * A rejection is not terminal. It clears back to undecided when whoever produced
 * the document re-issues it, because it is the same approval being sought again
 * on the same thread — see `openDeveloperRevision` below, which is what carries
 * the developer's reasons to whoever has to act on them.
 *
 * Per document now, and that is the change. The covenant covers the full
 * architectural design as well as the bushfire report — what an estate protects is
 * the house as it will be built, not only its bushfire rating — and the two go
 * over independently, weeks or months apart, because they are produced by
 * different people. One verdict on the outreach row could hold one answer, so the
 * second request overwrote the first and the block showed a single decision for
 * whichever document had most recently been sent.
 */
export async function recordDeveloperDecision(params: {
  projectId: string;
  /**
   * Which document they are answering about.
   *
   * Defaulted to the bushfire report rather than required, which is the one piece
   * of leniency in this signature and it is deliberate: the inbound workflow reads
   * a verdict off a reply that very often does not say which document it is about
   * — "approved, go ahead" on a thread carrying both. Defaulting to the report
   * keeps the behaviour the model path already had, and an admin correcting it
   * names the document explicitly.
   */
  documentType?: DeveloperApprovalDocument;
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

  const documentType =
    params.documentType ?? ComplianceDocumentType.BUSHFIRE_REPORT;
  const documentLabel = complianceDocumentLabel(documentType).toLowerCase();

  const rejecting =
    params.decision === ComplianceApprovalDecision.REJECTED;
  const reason = params.reason?.trim() || null;

  if (rejecting && !reason) {
    throw new Error(
      `A rejection needs the developer's reasons — they are what whoever produced the ${documentLabel} is sent.`,
    );
  }

  const existing = developerApprovalFor(engagement, documentType);

  // A person's decision stands against a later automated read of the same
  // thread. The reverse is not true: an admin correcting what the extraction
  // concluded is exactly what the button is for.
  //
  // Read off this document's own row rather than the outreach, which is the
  // correction the per-document rows make: an admin who recorded the plans by hand
  // used to block every later parsed verdict on the file, including one about the
  // bushfire report they had said nothing about.
  if (
    params.channel === ComplianceApprovalChannel.INBOUND_EMAIL &&
    existing?.channel === ComplianceApprovalChannel.ADMIN
  ) {
    return engagement;
  }

  /**
   * The verdict, against the document it is about.
   *
   * Upserted rather than updated, because a verdict can arrive on a document
   * nobody recorded sending — an admin reading a developer's unprompted reply
   * about plans that went over by post. `requestedAt` falls back to the outreach's
   * own send date, which is the best available answer to "since when" on a request
   * the file did not record.
   */
  await prisma.complianceDeveloperApproval.upsert({
    where: {
      outreachId_documentType: {
        outreachId: developer.id,
        documentType,
      },
    },
    create: {
      outreachId: developer.id,
      documentType,
      requestedAt: developer.sentAt ?? new Date(),
      decision: params.decision,
      decidedAt: new Date(),
      channel: params.channel,
      reason: rejecting ? reason : null,
      recordedById: params.decidedById ?? null,
    },
    update: {
      decision: params.decision,
      decidedAt: new Date(),
      channel: params.channel,
      reason: rejecting ? reason : null,
      recordedById: params.decidedById ?? null,
    },
  });

  // Either answer ends the wait on them, and it ends the wait on *this* document
  // only. The report being rejected is still the developer having answered, and
  // leaving the alert open would chase somebody who has already replied while the
  // job waits on a consultant instead.
  await resolveComplianceAlertBySystem({
    projectId: params.projectId,
    engagementId: engagement.id,
    type: DEVELOPER_WAIT_ALERT[documentType],
    resolutionNote: rejecting
      ? `The developer rejected the ${documentLabel}.`
      : `The developer approved the ${documentLabel}.`,
  });

  if (rejecting && reason) {
    // Sent inside the same call rather than left to a second click, because the
    // rejection and the rework are one act: a file that has recorded a refusal
    // and not passed it on is a fortnight of nobody doing anything, and the
    // reasons are already in hand.
    await openDeveloperRevision({
      projectId: params.projectId,
      engagement,
      documentType,
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
 * Sends a developer's refusal back to whoever produced the document.
 *
 * The same shape as `reviewArchitectPlans` refusing a set of plans, and it
 * reuses the same table: a round is written, the words that caused it go out on
 * the thread, and the round stays open until a replacement lands.
 *
 * Routed by document rather than fixed on the bushfire consultant, which is what
 * bringing the architectural design under the covenant forces. A refused report
 * goes back to the consultant who wrote it; refused plans go back to the
 * architect who drew them. Sending either to the other party is a fortnight lost
 * on a job that was already waiting — the consultant cannot redraw an elevation
 * and the architect cannot reassess a BAL rating.
 *
 * What differs per document is the party, the alert and one sentence of the mail;
 * everything else — the round, the attachment of the copy they actually read, the
 * alert raised whether or not the mail went — is identical, so it is one function
 * with a table rather than two that would drift.
 *
 * Never throws, and that is deliberate at this one call site. The verdict has
 * already been recorded and is already on the screen; a mailbox that is down is
 * not a reason to fail the click that recorded it, because the alternative is
 * an admin who pressed Reject, saw an error, and has no way to tell whether the
 * refusal was stored. The round is written before the mail, so a send that
 * fails leaves a visible, obviously incomplete round rather than nothing.
 */

/**
 * Who redoes each document under covenant, and what the wait on them is called.
 *
 * The architect's revision alert is deliberately the same ARCHITECT_REVISION_
 * OVERDUE the client's own redraws use, and not a new type. The wait is
 * identical — an architect owes a revised set — and at most one alert of a type
 * is open per file, which is the right behaviour here: a job whose plans have
 * been refused by the client *and* the developer is waiting on one redraw, not
 * two. The round itself carries who objected, so the chase quotes the right
 * words.
 */
const DEVELOPER_REVISION: Readonly<
  Record<
    DeveloperApprovalDocument,
    {
      party: CompliancePartyType;
      alertType: ComplianceAlertType;
      /** How the mail describes what they are being asked to redo. */
      ask: string;
    }
  >
> = {
  [ComplianceDocumentType.BUSHFIRE_REPORT]: {
    party: CompliancePartyType.BUSHFIRE_CONSULTANT,
    alertType: ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE,
    ask: "revise the assessment to address that and send the updated report back on this thread",
  },
  [ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN]: {
    party: CompliancePartyType.ARCHITECT,
    alertType: ComplianceAlertType.ARCHITECT_REVISION_OVERDUE,
    ask: "revise the drawings to address that and send the updated set back on this thread",
  },
};

async function openDeveloperRevision(params: {
  projectId: string;
  engagement: CertifierEngagementDetail;
  documentType: DeveloperApprovalDocument;
  reason: string;
}): Promise<void> {
  const { engagement, reason, documentType } = params;
  const route = DEVELOPER_REVISION[documentType];
  const documentLabel = complianceDocumentLabel(documentType).toLowerCase();
  const producer = outreachForParty(engagement, route.party);

  if (!producer) {
    // The document came from somewhere else — the client's own consultant, or
    // their paperwork. There is nobody on this file to send it back to, so the
    // rejection is recorded and the alert says what has to happen next.
    await raiseComplianceAlert({
      projectId: params.projectId,
      engagementId: engagement.id,
      type: route.alertType,
      raisedBySource: ComplianceAlertSource.DEVELOPER,
      detail: `The developer rejected the ${documentLabel} and there is nobody engaged on this file to redo it. Their reasons: ${reason}`,
    });
    return;
  }

  const round = await prisma.compliancePlanRevision.create({
    data: {
      outreachId: producer.id,
      feedback: reason,
      // What makes this round the developer's rather than the client's. Without
      // it a covenant refusal counted towards the revision rounds the architect
      // card reports and ran under the clock for a different wait — see
      // `outstandingRevision`.
      requestedBySource: ComplianceAlertSource.DEVELOPER,
    },
  });

  try {
    const refused = engagement.documents.find(
      (document) => document.documentType === documentType,
    );
    await sendOnPartyThread({
      engagement,
      outreach: producer,
      body: [
        `<p>Hi${producer.contactName ? ` ${producer.contactName}` : ""},</p>`,
        `<p>The estate developer has reviewed the ${escapeEmailHtml(
          documentLabel,
        )} for <strong>${escapeEmailHtml(
          engagement.subjectAddress,
        )}</strong> and has not approved it. This is what they said:</p>`,
        `<blockquote style="margin:0 0 1em;padding:0 0 0 1em;border-left:3px solid #ccc;">${escapeEmailHtml(
          reason,
        )}</blockquote>`,
        `<p>Could you ${route.ask}? It goes straight back to them once we have it.</p>`,
        "<p>Kind regards,<br/>Royal Constructions</p>",
      ].join("\n"),
      // The copy they wrote, so the revision is against what the developer
      // actually read rather than whichever draft is on their desk.
      attachments: (refused?.files ?? []).map((file) => ({
        name: file.filename,
        url: file.url,
      })),
    });
  } catch (error) {
    console.error(
      `Could not send the developer's rejection of the ${documentLabel} to the ${route.party.toLowerCase()}`,
      error,
    );
  }

  // Raised whether or not the mail went, because the wait is real either way
  // and this is the line that tells somebody to check.
  await raiseComplianceAlert({
    projectId: params.projectId,
    engagementId: engagement.id,
    type: route.alertType,
    raisedBySource: ComplianceAlertSource.DEVELOPER,
    detail: reason,
  });

  await logAction(
    createActivityLogEntry("complianceBushfireRevisionRequested", {
      projectId: params.projectId,
      engagementId: engagement.id,
      outreachId: producer.id,
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
  // Against this document's own approval row, and only where the verdict was a
  // refusal. A revised report arriving must not clear an *approval*: the
  // developer has already said yes, the replacement is an improvement on
  // something they accepted, and clearing it would put a job that was through
  // this gate back behind it.
  //
  // Scoped to BUSHFIRE_REPORT rather than to the outreach, which is what the
  // per-document rows make possible and what the outreach columns could not
  // express: a revised report used to clear whatever single verdict the row held,
  // including one about the architectural design that nobody had touched.
  const cleared = await prisma.complianceDeveloperApproval.updateMany({
    where: {
      outreach: {
        engagementId: params.engagementId,
        party: CompliancePartyType.DEVELOPER,
      },
      documentType: ComplianceDocumentType.BUSHFIRE_REPORT,
      decision: ComplianceApprovalDecision.REJECTED,
    },
    data: {
      decision: null,
      decidedAt: null,
      channel: null,
      recordedById: null,
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
 * Puts one document under covenant in front of the developer.
 *
 * Both halves of the loop in one function, because they are one act: the first
 * send and every re-send are a message on a thread that already exists, asking the
 * same question about the same document. The outreach and the thread are created
 * when the developer is engaged, so this never creates either — which is also what
 * keeps the whole conversation, refusal and all, in one place a person can read
 * top to bottom.
 *
 * Per document, which is the change. It sent the bushfire report and nothing else,
 * because the report was the only thing under covenant; the architectural design
 * now goes the same way and through the same thread.
 *
 * The clock is stamped on this document's approval row rather than on the
 * outreach, and that is the fix the rows exist for. `outreach.sentAt` belongs to
 * the engagement as a whole — it is when the developer was first written to — and
 * measuring both documents from it had the plans reading as overdue on the day
 * they were sent, because the report had gone over eleven working days earlier.
 *
 * `requestedAt` *is* re-stamped on a re-send, unlike `outreach.sentAt` which was
 * deliberately left alone. The two differ because they answer different questions:
 * the outreach's date is when this party joined the job, and this one is how long
 * they have had the thing they are being asked about. A round two that kept round
 * one's date would be overdue the moment it went out.
 */
export async function resendDeveloperApproval(params: {
  projectId: string;
  /** Which document to put to them. Defaults to the bushfire report. */
  documentType?: DeveloperApprovalDocument;
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

  const documentType =
    params.documentType ?? ComplianceDocumentType.BUSHFIRE_REPORT;
  const documentLabel = complianceDocumentLabel(documentType).toLowerCase();

  const document = engagement.documents.find(
    (row) => row.documentType === documentType,
  );
  if (!document || document.files.length === 0) {
    throw new Error(
      `There is no ${documentLabel} on the file to send them.`,
    );
  }

  const extras = await resolveExtraAttachments(
    params.projectId,
    params.extraAttachmentIds ?? [],
  );
  const documentFileIds = new Set(document.files.map((file) => file.id));

  const note = params.note?.trim() || null;
  // What they said last time, where they have seen this document before. Read off
  // the document's own approval row, so a refusal of the plans is not quoted into
  // a mail about the report.
  const existing = developerApprovalFor(engagement, documentType);
  const previous = existing?.reason?.trim() || null;
  const isFirstAsk = !existing;

  await sendOnPartyThread({
    engagement,
    outreach: developer,
    body: [
      `<p>Hi${developer.contactName ? ` ${developer.contactName}` : ""},</p>`,
      previous
        ? `<p>The ${escapeEmailHtml(documentLabel)} for <strong>${escapeEmailHtml(
            engagement.subjectAddress,
          )}</strong> has been revised to address what you raised:</p><blockquote style="margin:0 0 1em;padding:0 0 0 1em;border-left:3px solid #ccc;">${escapeEmailHtml(
            previous,
          )}</blockquote>`
        : isFirstAsk
          ? `<p>Please find the ${escapeEmailHtml(documentLabel)} for <strong>${escapeEmailHtml(
              engagement.subjectAddress,
            )}</strong>, which we understand needs your approval under the estate covenant.</p>`
          : `<p>Here is the ${escapeEmailHtml(documentLabel)} for <strong>${escapeEmailHtml(
              engagement.subjectAddress,
            )}</strong> again.</p>`,
      `<p>It is attached. Could you let us know whether you approve it? If it does not meet the covenant, please tell us what has to change.</p>`,
      note ? `<p>${escapeEmailHtml(note)}</p>` : "",
      "<p>Kind regards,<br/>Royal Constructions</p>",
    ]
      .filter(Boolean)
      .join("\n"),
    attachments: [
      ...document.files.map((file) => ({ name: file.filename, url: file.url })),
      ...extras
        .filter((file) => !documentFileIds.has(file.id))
        .map((file) => ({ name: file.filename, url: file.url })),
    ],
  });

  // Back to undecided, whatever it was, and the clock restarted. This is the same
  // question being asked again about the same document, and a verdict left over
  // from the last round would show against a copy they have not seen.
  await prisma.complianceDeveloperApproval.upsert({
    where: {
      outreachId_documentType: { outreachId: developer.id, documentType },
    },
    create: { outreachId: developer.id, documentType, requestedAt: new Date() },
    update: {
      requestedAt: new Date(),
      decision: null,
      decidedAt: null,
      channel: null,
      recordedById: null,
      // Bumped rather than reset, so the block can say how many times this has
      // been round. The reasons are kept for the same purpose: they are what this
      // send was written to answer, and the only record of why it went round twice.
      round: { increment: 1 },
    },
  });

  await prisma.complianceOutreach.update({
    where: { id: developer.id },
    data: { lastFollowUpAt: new Date() },
  });

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceDeveloperResent", {
        projectId: params.projectId,
        engagementId: engagement.id,
        outreachId: developer.id,
        attachmentCount: document.files.length + extras.length,
        requestedBy: params.requestedByName ?? null,
      }),
    );
    await notifyCompliance("complianceDeveloperResent", params.projectId, {
      party: PARTY_LABEL[CompliancePartyType.DEVELOPER],
      documentLabel: complianceDocumentLabel(documentType),
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

// ---------------------------------------------------------------------------
// Who the developer is
// ---------------------------------------------------------------------------

/**
 * Records whether this lot is in an estate, and who the developer is.
 *
 * One function for both halves of the banner's question, because they are one
 * answer. "Is this land under a developer" and "here is their address" are asked
 * and answered together, and splitting them meant a file could say yes and hold
 * nobody — which is exactly the state the old flow left jobs in whose estate was
 * not on the checked-in list.
 *
 * Supersedes nothing. `constants/complianceDevelopers.ts` is still the fast path
 * and still the better one where it applies: picking "Elara" off a combobox is
 * quicker and less error-prone than typing an approvals address nobody has to
 * hand. What this adds is the estate that is not on the list — a few dozen are,
 * against hundreds that exist and new ones every quarter.
 *
 * Answering "no" is a real answer and is recorded as one, which is the half that
 * is easy to get wrong. It sets the source to MANUAL with the three fields left
 * null, and that combination is what stops the land deed being parsed on every
 * upload for the rest of the job: a person has said there is no developer, and a
 * document cannot contradict them.
 *
 * Does not delete a developer outreach that already exists. Somebody correcting a
 * mis-answer must not silently discard a thread with real messages on it; the gate
 * stops reading the approval and the thread stays on the file where it can be
 * seen.
 */
export async function setEstateDeveloper(params: {
  projectId: string;
  /** Whether the lot is in an estate with a covenant at all. */
  required: boolean;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  recordedById: string;
  recordedByName?: string | null;
}): Promise<CertifierEngagementDetail> {
  // Reached only from the admin banner. The answer gates the portal lodgement and
  // the development application both, so an unauthenticated flip of it lodges a
  // pack without a covenanted approval.
  await requireComplianceAccess(params.projectId);

  const engagement = await requireEngagement(params.projectId);

  const name = params.name?.trim() || null;
  const email = params.email?.trim() || null;
  const phone = params.phone?.trim() || null;

  if (params.required && !name) {
    throw new Error(
      "A lot under a covenant needs the developer's name — it is who the approval is sought from.",
    );
  }

  await prisma.certifierEngagement.update({
    where: { id: engagement.id },
    data: {
      developerApprovalRequired: params.required,
      // Cleared on a "no", rather than left behind. A file that has been
      // corrected from yes to no must not keep an address the gate no longer
      // reads — it would show on the tab as a developer nobody is writing to.
      estateDeveloperName: params.required ? name : null,
      estateDeveloperEmail: params.required ? email : null,
      estateDeveloperPhone: params.required ? phone : null,
      // MANUAL either way, which is the point. See the note above: a person's
      // answer is what stops the land deed parse, and answering "no" is an answer.
      estateDeveloperSource: EstateDeveloperSource.MANUAL,
      estateDeveloperRecordedAt: new Date(),
      estateDeveloperRecordedById: params.recordedById,
    },
  });

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceDeveloperApprovalRequirementSet", {
        projectId: params.projectId,
        engagementId: engagement.id,
        required: params.required,
        answeredBy: params.recordedByName ?? null,
      }),
    );
  });

  return requireEngagement(params.projectId);
}

/**
 * Records a developer read off the land deed, if nobody has answered already.
 *
 * The fallback half of the question, and deliberately the weaker one. The deed is
 * the document that names whoever released the land, and it is already on the file
 * by the time a surveyor is engaged — so parsing it costs nothing and answers a
 * question somebody would otherwise have to be asked.
 *
 * Guarded on `estateDeveloperSource` being null, which is the whole of its
 * courtesy. A person who typed the estate's approvals address in, or who said
 * there is no developer on this lot, has told us something a parse cannot argue
 * with: MANUAL stops this for good. A previous parse does not — a second deed, or
 * a re-run after the extraction improved, is allowed to correct itself.
 *
 * Sets `developerApprovalRequired` only when it finds somebody. A deed that names
 * no developer is not evidence that there is none: plenty of lots are sold by a
 * private vendor through an estate that still holds the covenant, and writing
 * `false` off a silent document would close the question with a guess and hide the
 * banner that would have got it answered properly.
 *
 * Never throws. It runs in an `after()` behind an upload that has already
 * succeeded, and a deed this cannot read is one somebody answers by hand.
 */
export async function recordEstateDeveloperFromDeed(params: {
  projectId: string;
  engagementId: string;
  file: { url: string; filename: string };
}): Promise<void> {
  try {
    const engagement = await prisma.certifierEngagement.findUnique({
      where: { id: params.engagementId },
      select: {
        id: true,
        estateDeveloperSource: true,
        developerApprovalRequired: true,
      },
    });

    if (!engagement) return;

    if (engagement.estateDeveloperSource === EstateDeveloperSource.MANUAL) {
      // Somebody has answered. Nothing a document says outranks that, including
      // an answer of "no developer on this lot" — which is why the check is on the
      // source rather than on the three fields being empty.
      return;
    }

    const found = await readLandDeedDeveloper(params.file);
    if (!found?.name) return;

    await prisma.certifierEngagement.update({
      where: { id: engagement.id },
      data: {
        developerApprovalRequired: true,
        estateDeveloperName: found.name,
        estateDeveloperEmail: found.email ?? null,
        estateDeveloperPhone: found.phone ?? null,
        estateDeveloperSource: EstateDeveloperSource.LAND_DEED,
        estateDeveloperRecordedAt: new Date(),
      },
    });

    revalidateEngagement(params.projectId);

    await logAction(
      createActivityLogEntry("complianceDeveloperApprovalRequirementSet", {
        projectId: params.projectId,
        engagementId: engagement.id,
        required: true,
        answeredBy: `the land deed (${params.file.filename})`,
      }),
    );
  } catch (error) {
    console.error(
      `Could not read the estate developer off the land deed on ${params.projectId}`,
      error,
    );
  }
}
