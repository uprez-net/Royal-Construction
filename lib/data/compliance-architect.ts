import "server-only";

import {
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceMeetingStatus,
  ComplianceOutreachMode,
  CompliancePartyType,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { PARTY_LABEL } from "@/constants/complianceDocuments";
import {
  escapeEmailHtml,
  resolveExtraAttachments,
  sendOnPartyThread,
  sydneyMeetingTime,
} from "@/lib/compliance/party-mail";
import { resolveComplianceAlertBySystem } from "@/lib/data/compliance-alerts";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  currentMeeting,
  outreachForParty,
  outstandingRevision,
  type CertifierEngagementDetail,
  type ComplianceOutreachDetail,
} from "@/types/compliance";
import type {
  ResolveComplianceMeetingInput,
  ReviewArchitectPlansInput,
  ScheduleComplianceMeetingInput,
  WasteManagementInput,
} from "@/utils/validators/compliance";
import { logAction } from "./actionLog";

/**
 * The part of the architect's engagement that is not a document.
 *
 * Between "we have engaged an architect" and "here are the preliminary plans"
 * sits a conversation the system could not see any of: the architect and the
 * client have to meet, that meeting routinely moves, the plans come back some
 * days later, and the client either signs off or asks for changes — often more
 * than once. All of it happened by phone, and the only trace on the file was
 * plans appearing one day with nothing to say whether that was fast or three
 * weeks late.
 *
 * Recording it is not bureaucracy for its own sake. Each of these events starts
 * a clock: the plans are due some working days after the meeting, a redraw some
 * working days after the feedback, and the daily sweep can only raise an alert
 * against a date that exists.
 */

/**
 * What the sender attached by hand, as a send wants it.
 *
 * A thin wrapper over `resolveExtraAttachments` so the three calls below read
 * the same and none of them has to remember that ids are resolved against the
 * project rather than trusted. The check itself is in that function: a caller
 * who could name a url could put anything on the storage account onto an
 * outbound email.
 */
async function extraAttachments(
  projectId: string,
  fileIds: readonly string[] | undefined,
) {
  const files = await resolveExtraAttachments(projectId, fileIds ?? []);
  return files.map((file) => ({ name: file.filename, url: file.url }));
}

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

async function requireEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
  if (!engagement) {
    throw new Error(
      "This project has no compliance file yet. Connect with a certifier first.",
    );
  }
  return engagement;
}

/**
 * The architect's thread, or a refusal explaining why there isn't one.
 *
 * The two ways there is nothing to write to are worth telling apart. Nobody has
 * engaged an architect yet is a step somebody skipped; the client supplied
 * their own drawings is a file that is correctly finished with architects and
 * where the meeting the caller is trying to book has no second party.
 */
async function requireArchitect(engagement: CertifierEngagementDetail): Promise<{
  outreach: ComplianceOutreachDetail;
}> {
  const outreach = outreachForParty(
    engagement,
    CompliancePartyType.ARCHITECT,
  );
  if (!outreach) {
    throw new Error(
      "No architect has been engaged on this job yet — engage one before booking a meeting.",
    );
  }
  if (!outreach.contactEmail) {
    throw new Error(
      "The architectural drawings were supplied by the client — there is no architect to write to.",
    );
  }
  return { outreach };
}

/** The client on a project, for the invitations and the revision requests. */
async function projectClient(projectId: string): Promise<{
  name: string;
  email: string | null;
} | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { customer: { select: { name: true, email: true } } },
  });
  return project?.customer ?? null;
}

// ---------------------------------------------------------------------------
// The meeting
// ---------------------------------------------------------------------------

function meetingInvitationBody(params: {
  architectName: string | null;
  clientName: string | null;
  subjectAddress: string;
  scheduledFor: Date;
  note: string | null;
  isReschedule: boolean;
}): string {
  const greeting = params.architectName
    ? `Hi ${escapeEmailHtml(params.architectName)}${params.clientName ? ` and ${escapeEmailHtml(params.clientName)}` : ""},`
    : "Hi both,";

  return [
    `<p>${greeting}</p>`,
    params.isReschedule
      ? `<p>The meeting about <strong>${escapeEmailHtml(params.subjectAddress)}</strong> has moved. The new time is:</p>`
      : `<p>We would like to get you both together about <strong>${escapeEmailHtml(params.subjectAddress)}</strong>. The time we have put in is:</p>`,
    `<p><strong>${escapeEmailHtml(sydneyMeetingTime(params.scheduledFor))}</strong> (Sydney time)</p>`,
    // Said plainly, because it is the entire purpose of the meeting and the
    // thing that goes wrong when it does not happen: an architect who has not
    // sat with the owners draws a generic house and finds out at the
    // preliminary stage.
    "<p>The aim is to go through what the owners are after so the preliminary plans are drawn against their brief rather than against assumptions.</p>",
    params.note ? `<p>${escapeEmailHtml(params.note)}</p>` : "",
    "<p>If that does not suit either of you, reply here and we will move it.</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Books the client and architect in, and tells them both.
 *
 * The row is written before the mail goes, matching every other send on this
 * file and for the same reason: a send that succeeds while the row recording it
 * does not is a meeting nobody can find, whereas a row whose mail failed is
 * visible, obviously wrong, and can be moved.
 *
 * Refuses a second booking rather than quietly adding one. A meeting that
 * already exists is moved through the resolution step, which knows to close the
 * one it replaces — booking again would leave two live meetings on one thread
 * and no answer to which one the plans clock runs from.
 */
export async function scheduleClientMeeting(
  projectId: string,
  input: ScheduleComplianceMeetingInput,
  recordedBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);
  const { outreach } = await requireArchitect(engagement);

  if (currentMeeting(outreach)) {
    throw new Error(
      "There is already a meeting on this job. Use the resolution step to move it or record that it happened.",
    );
  }

  const client = await projectClient(projectId);

  const meeting = await prisma.complianceMeeting.create({
    data: {
      outreachId: outreach.id,
      scheduledFor: input.scheduledFor,
      note: input.note ?? null,
    },
  });

  await sendOnPartyThread({
    engagement,
    outreach,
    alsoTo: client?.email ? [client.email] : [],
    body: meetingInvitationBody({
      architectName: outreach.contactName,
      clientName: client?.name ?? null,
      subjectAddress: engagement.subjectAddress,
      scheduledFor: input.scheduledFor,
      note: input.note ?? null,
      isReschedule: false,
    }),
    // The one message on this file both the client and the architect receive,
    // and therefore the one place an agenda or the client's own sketches reach
    // both of them at once.
    attachments: await extraAttachments(projectId, input.extraAttachmentIds),
  });

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("complianceMeetingScheduled", {
        projectId,
        engagementId: engagement.id,
        outreachId: outreach.id,
        meetingId: meeting.id,
        scheduledFor: sydneyMeetingTime(input.scheduledFor),
        isReschedule: false,
        recordedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

/**
 * Records what became of the meeting.
 *
 * Two outcomes, and they are genuinely different acts. "It happened" closes the
 * row and starts the preliminary-plans clock, which is the only reason any of
 * this is tracked. "It moved" closes the row as superseded and opens a new one,
 * which keeps the trail honest about a meeting that took three attempts — a
 * status field alone would remember only the last of them.
 */
export async function resolveClientMeeting(
  projectId: string,
  input: ResolveComplianceMeetingInput,
  recordedBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);
  const { outreach } = await requireArchitect(engagement);

  const meeting = currentMeeting(outreach);
  if (!meeting) {
    throw new Error("There is no meeting on this job to resolve.");
  }
  if (meeting.status === ComplianceMeetingStatus.HELD) {
    throw new Error("That meeting is already recorded as having taken place.");
  }

  if (input.outcome === "held") {
    // Falls back to the booked time, which is right far more often than it is
    // wrong: most meetings happen when they were booked, and the override
    // exists for the case where one slipped a week without being formally
    // moved. The plans clock runs from whichever this is.
    const heldAt = input.heldAt ?? meeting.scheduledFor;

    await prisma.complianceMeeting.update({
      where: { id: meeting.id },
      data: {
        status: ComplianceMeetingStatus.HELD,
        heldAt,
        note: input.note ?? meeting.note,
      },
    });

    after(async () => {
      revalidateEngagement(projectId);
      await logAction(
        createActivityLogEntry("complianceMeetingHeld", {
          projectId,
          engagementId: engagement.id,
          outreachId: outreach.id,
          meetingId: meeting.id,
          heldAt: sydneyMeetingTime(heldAt),
          recordedBy,
        }),
      );
    });

    return requireEngagement(projectId);
  }

  // Rescheduled. The old row is closed rather than edited, so "this moved
  // twice" is readable off the file — which is the thing somebody asks about
  // when the plans are late.
  const client = await projectClient(projectId);

  const replacement = await prisma.$transaction(async (tx) => {
    await tx.complianceMeeting.update({
      where: { id: meeting.id },
      data: {
        status: ComplianceMeetingStatus.RESCHEDULED,
        note: input.note ?? meeting.note,
      },
    });
    return tx.complianceMeeting.create({
      data: {
        outreachId: outreach.id,
        scheduledFor: input.scheduledFor,
        note: input.note ?? null,
      },
    });
  });

  await sendOnPartyThread({
    engagement,
    outreach,
    alsoTo: client?.email ? [client.email] : [],
    body: meetingInvitationBody({
      architectName: outreach.contactName,
      clientName: client?.name ?? null,
      subjectAddress: engagement.subjectAddress,
      scheduledFor: input.scheduledFor,
      note: input.note ?? null,
      isReschedule: true,
    }),
    attachments: await extraAttachments(projectId, input.extraAttachmentIds),
  });

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("complianceMeetingScheduled", {
        projectId,
        engagementId: engagement.id,
        outreachId: outreach.id,
        meetingId: replacement.id,
        scheduledFor: sydneyMeetingTime(input.scheduledFor),
        isReschedule: true,
        recordedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

// ---------------------------------------------------------------------------
// The client's verdict on the plans
// ---------------------------------------------------------------------------

function revisionRequestBody(params: {
  architectName: string | null;
  subjectAddress: string;
  feedback: string;
  round: number;
}): string {
  const greeting = params.architectName
    ? `Hi ${escapeEmailHtml(params.architectName)},`
    : "Hi,";

  return [
    `<p>${greeting}</p>`,
    `<p>The owners have been through the preliminary plans for <strong>${escapeEmailHtml(params.subjectAddress)}</strong> and have come back with changes${params.round > 1 ? ` (round ${params.round})` : ""}:</p>`,
    // Verbatim, in a quote block. The client's own words are the entire content
    // of this mail, and a paraphrase is how "move the study to the north side"
    // becomes "some changes to the layout" and then a second round.
    `<blockquote style="margin:0 0 0 1em;padding-left:1em;border-left:3px solid #ccc;">${escapeEmailHtml(
      params.feedback,
    ).replace(/\n/g, "<br/>")}</blockquote>`,
    "<p>Could you send the revised set through when you have them?</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ].join("\n");
}

/**
 * Records whether the client signed off on the preliminary plans.
 *
 * The gate on everything downstream. Approval is what opens the send to the
 * certifier: a pack built on plans the client has not seen is a pack that comes
 * back, because the certifier assesses a design the client then changes.
 *
 * A rejection is not a refusal to proceed — it is a round of work with a clock
 * on it. The feedback goes to the architect verbatim, the round is recorded,
 * and the sweep chases it if no revised set arrives. Rounds are rows rather
 * than a counter so that "this has been through three" is readable, along with
 * what was asked for each time.
 */
export async function reviewArchitectPlans(
  projectId: string,
  input: ReviewArchitectPlansInput,
  recordedBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);
  const { outreach } = await requireArchitect(engagement);

  if (input.approved) {
    await prisma.complianceOutreach.update({
      where: { id: outreach.id },
      data: { clientPlansApprovedAt: new Date() },
    });

    // Any round still open is answered by the approval, whatever arrived in
    // between. Leaving it open would keep an overdue alert on a revision the
    // client has since accepted.
    await prisma.compliancePlanRevision.updateMany({
      where: { outreachId: outreach.id, respondedAt: null },
      data: { respondedAt: new Date() },
    });

    await resolveComplianceAlertBySystem({
      projectId,
      engagementId: engagement.id,
      type: ComplianceAlertType.ARCHITECT_REVISION_OVERDUE,
      resolutionNote: "The client approved the plans.",
    });
  } else {
    const round = outreach.revisions.length + 1;
    const feedback = input.feedback ?? "";

    // Refused rather than silently stacked. Two open rounds means two clocks on
    // one thread and no answer to which one the architect is late against — and
    // in practice it is somebody clicking twice, not a second genuine round.
    if (outstandingRevision(outreach)) {
      throw new Error(
        "There is already a round of revisions with the architect. Chase that one, or record the revised plans when they land.",
      );
    }

    await prisma.compliancePlanRevision.create({
      data: { outreachId: outreach.id, feedback },
    });

    await sendOnPartyThread({
      engagement,
      outreach,
      body: revisionRequestBody({
        architectName: outreach.contactName,
        subjectAddress: engagement.subjectAddress,
        feedback,
        round,
      }),
      // A client rejecting a set of plans routinely marks them up -- a
      // photograph of the printout, a sketch on the back of an envelope -- and
      // the words alone lose exactly the part the architect needs most.
      attachments: await extraAttachments(projectId, input.extraAttachmentIds),
    });
  }

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("compliancePlansReviewed", {
        projectId,
        engagementId: engagement.id,
        outreachId: outreach.id,
        approved: input.approved,
        feedback: input.feedback,
        recordedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

/**
 * Closes the loop when a set of preliminary plans lands.
 *
 * Called from both upload paths — the architect emailing them in, and an admin
 * dragging in the copy they were sent — because the two are the same event and
 * only one of them used to be visible.
 *
 * What it closes is deliberately narrow. A revision round is marked answered
 * and the two architect alerts are resolved; the client's approval is not
 * touched, because a revised set is precisely the thing the client has not seen
 * yet. Marking it approved here would open the certifier send on the strength
 * of plans nobody had looked at.
 *
 * Never throws. It runs behind an upload that has already succeeded.
 */
export async function recordPreliminaryPlansArrival(params: {
  projectId: string;
  engagementId: string;
}): Promise<void> {
  try {
    const outreach = await prisma.complianceOutreach.findFirst({
      where: {
        engagementId: params.engagementId,
        party: CompliancePartyType.ARCHITECT,
      },
      select: { id: true },
    });
    if (!outreach) return;

    await prisma.compliancePlanRevision.updateMany({
      where: { outreachId: outreach.id, respondedAt: null },
      data: { respondedAt: new Date() },
    });

    await resolveComplianceAlertBySystem({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: ComplianceAlertType.ARCHITECT_PLANS_OVERDUE,
      resolutionNote: `The ${PARTY_LABEL[
        CompliancePartyType.ARCHITECT
      ].toLowerCase()} sent the preliminary plans through.`,
    });
    await resolveComplianceAlertBySystem({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: ComplianceAlertType.ARCHITECT_REVISION_OVERDUE,
      resolutionNote: "A revised set of preliminary plans arrived.",
    });
  } catch (error) {
    console.error("  Failed to record the preliminary plans' arrival:", error);
  }
}

/**
 * Asks the architect for the waste management plan.
 *
 * The one document on this file that is commissioned from somebody already
 * engaged. Every other consultant needs a firm picked, a contact snapshotted
 * and a thread opened; the architect has all three from the day the plans were
 * commissioned, and the waste management plan is drawn against the design they
 * themselves produced. Sending it to a stranger would mean sending them the
 * whole set to read first.
 *
 * So this is a send rather than an engagement: it rides the existing thread,
 * attaches the plans they already have as the thing to draw against, and stamps
 * a clock of its own. The clock is the reason the column exists — the outreach
 * that engaged them may be months old, and an SLA read off that would be past
 * on the day the plan was asked for.
 *
 * Refuses where there is nothing to send on. A file whose plans the client
 * supplied themselves has a SELF_SUPPLIED architect row with no address, and a
 * request that silently did nothing would leave a row marked as asked for that
 * nobody was ever asked for.
 */
export async function requestWasteManagementPlan(
  projectId: string,
  input: WasteManagementInput,
  requestedBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);
  const outreach = outreachForParty(engagement, CompliancePartyType.ARCHITECT);

  if (!outreach) {
    throw new Error(
      "No architect has been engaged on this job — there is nobody to ask for a waste management plan.",
    );
  }
  if (
    !outreach.contactEmail ||
    outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED
  ) {
    throw new Error(
      "The architectural plans were supplied by the client, so there is no architect thread here. This one has to be asked for by hand.",
    );
  }

  // What they are being asked to draw against. Resolved off the document rows
  // rather than passed in, exactly as the opening outreach does it, so the mail
  // carries the current copy of the design rather than whatever the browser
  // happened to be showing. The full set where there is one, and the
  // preliminary set where there is not — a waste management plan can honestly
  // be drawn off either, and holding the request until the full design lands
  // would stall a development application that is otherwise ready.
  const attachmentTypes: readonly ComplianceDocumentType[] = [
    ComplianceDocumentType.FULL_ARCHITECTURAL_DESIGN,
    ComplianceDocumentType.PRELIMINARY_ARCHITECTURAL_PLANS,
  ];
  const planFiles = attachmentTypes.flatMap((type) =>
    engagement.documents
      .filter((document) => document.documentType === type)
      .flatMap((document) =>
        document.files.map((file) => ({
          id: file.id,
          name: file.filename,
          url: file.url,
        })),
      ),
  );

  /**
   * The checklist line this request answers, if it is one of ours.
   *
   * The route authorises the project and validates the shape of the id, and the
   * foreign key checks only that the document exists — so an id belonging to
   * another engagement was accepted and stored. Nothing loud follows: the
   * inbound workflow cannot resolve a target outside this engagement, so it
   * files the architect's reply under its own type instead and the line that
   * asked stays outstanding forever, with a deliverable row pointing at
   * somebody else's job.
   *
   * Dropped rather than refused. A stale id is what a re-extracted checklist
   * leaves behind, and the request itself is still the right thing to send.
   */
  const checklistDocumentId =
    input.checklistDocumentId &&
    engagement.documents.some(
      (document) => document.id === input.checklistDocumentId,
    )
      ? input.checklistDocumentId
      : null;

  // What the sender added on top -- the certifier's own wording on the line
  // that asked for the plan, most often, which saves the architect being told
  // second-hand what a waste management plan has to say on this council.
  const extras = await resolveExtraAttachments(
    projectId,
    input.extraAttachmentIds ?? [],
  );
  const planIds = new Set(planFiles.map((file) => file.id));
  const attachments = [
    ...planFiles.map((file) => ({ name: file.name, url: file.url })),
    // De-duplicated against the plans, because the picker offers everything on
    // the file and the obvious thing to reach for is the design they were going
    // to be sent anyway.
    ...extras
      .filter((file) => !planIds.has(file.id))
      .map((file) => ({ name: file.filename, url: file.url })),
  ];

  await sendOnPartyThread({
    engagement,
    outreach,
    body: wasteManagementBody({
      contactName: outreach.contactName,
      subjectAddress: engagement.subjectAddress,
      note: input.note ?? null,
      hasAttachments: attachments.length > 0,
    }),
    attachments,
  });

  await prisma.$transaction(async (tx) => {
    // Stamped rather than upserted onto a fresh row: the clock starts at the
    // first ask. A second request a fortnight later is a chase, and moving the
    // date would mean an overdue plan resetting itself every time somebody
    // chased it — which is the exact failure `sentAt` was separated from
    // `updatedAt` to avoid.
    await tx.complianceOutreach.updateMany({
      where: { id: outreach.id, wasteManagementRequestedAt: null },
      data: { wasteManagementRequestedAt: new Date() },
    });

    // Recorded as a deliverable so the reply can be filed against the checklist
    // line that asked, the same way a consultant's is. Skipped where there is
    // no line — on the development application path the plan is filed under its
    // own type, which is the right answer when nothing asked for it by name.
    await tx.complianceOutreachDeliverable.upsert({
      where: {
        outreachId_documentType: {
          outreachId: outreach.id,
          documentType: ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
        },
      },
      create: {
        outreachId: outreach.id,
        documentType: ComplianceDocumentType.WASTE_MANAGEMENT_PLAN,
        checklistDocumentId,
      },
      // A second request that names a checklist line where the first named
      // none fills it in; one that names none leaves what is there alone.
      update: checklistDocumentId ? { checklistDocumentId } : {},
    });
  });

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      // No `contactEmail`. It is an external party's personal address and the
      // activity log is persisted and rendered in the project feed, so writing
      // it there puts PII in a long-lived record for no gain: `outreachId`
      // already identifies the thread, and the outreach row holds the address
      // for anybody who needs it.
      createActivityLogEntry("complianceWasteManagementRequested", {
        projectId,
        engagementId: engagement.id,
        outreachId: outreach.id,
        attachmentCount: attachments.length,
        requestedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

/**
 * The body of the request.
 *
 * Short, and specific about the one thing that makes it answerable: which
 * design the plan is for. An architect with four jobs on gets "can you do us a
 * waste management plan" from three of them a month, and the address plus the
 * attached set is the difference between a reply and a phone call.
 */
function wasteManagementBody(params: {
  contactName: string | null;
  subjectAddress: string;
  note: string | null;
  hasAttachments: boolean;
}): string {
  const greeting = params.contactName
    ? `Hi ${escapeEmailHtml(params.contactName)},`
    : "Hi,";

  return [
    `<p>${greeting}</p>`,
    `<p>Could you put together a waste management plan for <strong>${escapeEmailHtml(
      params.subjectAddress,
    )}</strong>, against the design you did for us?</p>`,
    "<p>It needs to cover the demolition and construction waste — what is generated, how much of it, and where each stream goes — in the format the council accepts.</p>",
    params.hasAttachments
      ? "<p>The current set is attached so you are working from the same drawings we are.</p>"
      : "",
    params.note ? `<p>${escapeEmailHtml(params.note)}</p>` : "",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Closes the waste management wait when the plan lands.
 *
 * The counterpart of `recordPreliminaryPlansArrival` above, and separate from
 * it for the reason the two clocks are separate: a revised set of plans is not
 * a waste management plan, and letting either close the other's alert would
 * mean an architect who redrew the elevations being credited with a document
 * they have not started.
 *
 * Never throws. It runs behind an upload or a classification that has already
 * succeeded.
 */
export async function recordWasteManagementPlanArrival(params: {
  projectId: string;
  engagementId: string;
}): Promise<void> {
  try {
    await resolveComplianceAlertBySystem({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE,
      resolutionNote: "The waste management plan arrived.",
    });
  } catch (error) {
    console.error(
      "  Failed to record the waste management plan's arrival:",
      error,
    );
  }
}
