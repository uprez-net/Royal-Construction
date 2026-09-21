import "server-only";

import {
  ComplianceAlertStatus,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  CompliancePartyType,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  complianceDocumentLabel,
  documentTypesForParty,
  isNotRequired,
  PARTY_LABEL,
  partyDeliverables,
} from "@/constants/complianceDocuments";
import { COMPLIANCE_ALERT_PARTY } from "@/lib/compliance/alert-parties";
import {
  escapeEmailHtml,
  sendOnPartyThread,
} from "@/lib/compliance/party-mail";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  outreachForParty,
  outstandingRevision,
  type CertifierEngagementDetail,
  type ComplianceAlertRecord,
  type ComplianceOutreachDetail,
} from "@/types/compliance";
import { logAction } from "./actionLog";

/**
 * The one-click chase behind an open alert.
 *
 * This started as `requestUpdatedTitleSearch` — one alert, one party, one
 * hard-coded body. Five more overdue conditions later, the choice was six
 * near-identical endpoints or one that knows which party each alert is about
 * and what to say to them. This is the second.
 *
 * The value is the same in every case and worth stating: the message is
 * entirely mechanical. It says what was asked for, when, and how long ago —
 * all of which is on the screen the person clicking is already looking at, and
 * all of which they would otherwise retype into their mail client. What they
 * would not do is get the reference token into the subject, which is what keeps
 * the reply attached to this job.
 *
 * Chasing is never resolving. Every one of these alerts closes when the thing
 * it is waiting for arrives, and none of them closes because somebody asked
 * again — that distinction is the difference between a panel that tracks
 * outstanding work and a panel of things people have clicked.
 */

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

/**
 * The body for one chase.
 *
 * Written per alert rather than from a template with a slot, because what makes
 * these worth sending is that each one says the specific thing. "Any update?"
 * is a message somebody has to reply to with a question of their own; "the
 * title search on file names the previous owners, here is the comparison" is a
 * message they can act on.
 */
function followUpBody(params: {
  alert: ComplianceAlertRecord;
  outreach: ComplianceOutreachDetail;
  subjectAddress: string;
  /** The file, for working out what is actually still outstanding. */
  engagement: CertifierEngagementDetail;
}): string {
  const { alert, outreach, subjectAddress } = params;
  const greeting = outreach.contactName
    ? `Hi ${escapeEmailHtml(outreach.contactName)},`
    : "Hi,";
  const address = `<strong>${escapeEmailHtml(subjectAddress)}</strong>`;
  const sign = [
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ];

  switch (alert.type) {
    case ComplianceAlertType.STALE_TITLE_SEARCH:
      return [
        `<p>${greeting}</p>`,
        `<p>The title search on file for ${address} does not name the current owners.</p>`,
        // The alert's own detail is the comparison that produced it: what the
        // register says against what we hold. Quoted rather than restated, so
        // the surveyor is looking at exactly what we are.
        alert.detail ? `<p>${escapeEmailHtml(alert.detail)}</p>` : "",
        "<p>Could you re-order the search and send the updated copy through? The land registry has most likely not been updated since settlement.</p>",
        ...sign,
      ]
        .filter(Boolean)
        .join("\n");

    case ComplianceAlertType.ARCHITECT_REVISION_OVERDUE: {
      // The feedback goes again, in full. An architect who has lost the earlier
      // message is exactly the reason this round is late, and a reminder that
      // does not carry what was asked for makes them go and find it.
      const revision = outstandingRevision(outreach);
      return [
        `<p>${greeting}</p>`,
        `<p>Following up on the revisions to the preliminary plans for ${address}. The owners came back with:</p>`,
        revision
          ? `<blockquote style="margin:0 0 0 1em;padding-left:1em;border-left:3px solid #ccc;">${escapeEmailHtml(
              revision.feedback,
            ).replace(/\n/g, "<br/>")}</blockquote>`
          : "",
        "<p>Could you let us know where the revised set is up to?</p>",
        ...sign,
      ]
        .filter(Boolean)
        .join("\n");
    }

    case ComplianceAlertType.ARCHITECT_PLANS_OVERDUE:
      return [
        `<p>${greeting}</p>`,
        `<p>Following up on the preliminary plans for ${address} after your meeting with the owners.</p>`,
        "<p>Could you let us know where they are up to, or when we can expect them? The certifier cannot start their assessment without them.</p>",
        ...sign,
      ].join("\n");

    case ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE:
      // The architect's third chase, and the only one that is not about a
      // document they were engaged for. Written out rather than falling through
      // to the list below, because that list would read off the architect's
      // pack deliverables and chase them for the plans they delivered months
      // ago instead of the plan they have not started.
      return [
        `<p>${greeting}</p>`,
        `<p>Following up on the waste management plan for ${address}.</p>`,
        "<p>Could you let us know where it is up to, or when we can expect it? The application cannot be lodged without it.</p>",
        ...sign,
      ].join("\n");

    default: {
      // The "we asked and nothing came back" cases — the surveyor and every
      // consultant — which differ only in what was asked for. Read off the
      // party's deliverables rather than written out per party, so a document
      // moving between parties cannot leave a chase asking the wrong firm for
      // it.
      //
      // Narrowed to what is actually still outstanding, which matters most for
      // the parties that produce several things: a structural engineer who sent
      // the drawings three weeks ago and still owes the geotechnical report
      // should be asked for the report, not handed their own delivery back as
      // though nothing had arrived.
      const deliverables =
        outreach.party === CompliancePartyType.SURVEYOR
          ? documentTypesForParty(outreach.party)
          : partyDeliverables(outreach.party);

      const outstanding = deliverables.filter(
        (type) => !isSuppliedOnFile(params.engagement, type, outreach),
      );

      // Nothing left to ask for. The fallback here used to be the whole list,
      // on the reading that an empty `outstanding` meant "none of it has
      // landed" -- which is exactly backwards: with nothing supplied,
      // `outstanding` is the whole list already, so the fallback could only
      // ever be reached when every deliverable was on the file. It then sent
      // the party a chase listing documents they had already delivered.
      //
      // The window is real. `sendComplianceFollowUp` only requires the alert to
      // be OPEN, and the sweep does not close it until its next run, so an
      // admin can press the chase in the hours between the last document
      // arriving and the alert clearing. Refusing is the honest answer, and it
      // is thrown for the same reason the two refusals in `sendComplianceFollow
      // Up` are: the sentence is what tells the reader the wait is actually
      // over, where silence would read as a send that failed.
      if (outstanding.length === 0) {
        throw new Error(
          `Everything we asked ${PARTY_LABEL[outreach.party].toLowerCase()} for is on the file — there is nothing left to chase. The alert closes on tonight's sweep.`,
        );
      }

      const wanted = outstanding.map((type) => complianceDocumentLabel(type));

      return [
        `<p>${greeting}</p>`,
        `<p>Following up on ${address}. We have not had anything back from you yet on:</p>`,
        `<ul>${wanted.map((label) => `<li>${escapeEmailHtml(label)}</li>`).join("")}</ul>`,
        "<p>Could you let us know where things are up to, or when we can expect them?</p>",
        ...sign,
      ].join("\n");
    }
  }
}

/**
 * Whether one of a party's deliverables has actually landed.
 *
 * Two places to look, because a consultant's document can be on the file under
 * either name. Where the engagement was raised off a checklist line, what they
 * sent satisfies that line and is filed as a CHECKLIST_ITEM with the
 * certifier's own wording on it — so a search by document type would find
 * nothing and the chase would ask for something already supplied. Where there
 * was no line, it is filed under its own type.
 */
function isSuppliedOnFile(
  engagement: CertifierEngagementDetail,
  documentType: ComplianceDocumentType,
  outreach: ComplianceOutreachDetail,
): boolean {
  const lineId = outreach.deliverables.find(
    (deliverable) => deliverable.documentType === documentType,
  )?.checklistDocumentId;

  return engagement.documents.some((document) => {
    if (document.files.length === 0 && !isNotRequired(document.status)) {
      return false;
    }
    return lineId
      ? document.id === lineId
      : document.documentType === documentType;
  });
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
 * Chases whoever an open alert is waiting on.
 *
 * Deliberately not a resolve. Asking is not fixing: every one of these closes
 * on its own when the thing arrives, and closing it here would take a genuinely
 * outstanding condition off the panel because somebody sent an email about it.
 *
 * `lastFollowUpAt` is stamped so the file records that somebody acted, which is
 * the question a second person looking at the same alert an hour later has.
 */
export async function sendComplianceFollowUp(
  projectId: string,
  alertId: string,
  sentBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);

  const alert = engagement.alerts.find((candidate) => candidate.id === alertId);
  if (!alert) {
    throw new Error("No such alert on this compliance file.");
  }
  if (alert.status !== ComplianceAlertStatus.OPEN) {
    throw new Error("That alert has already been closed.");
  }

  const party = COMPLIANCE_ALERT_PARTY[alert.type];
  if (!party) {
    throw new Error(
      "There is nobody to chase on this one — it has to be followed up by hand.",
    );
  }

  const outreach = outreachForParty(engagement, party);
  if (
    !outreach?.contactEmail ||
    outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED
  ) {
    // Refused with the reason rather than silently doing nothing, because the
    // fix is a person going to whoever actually supplied the document.
    throw new Error(
      `No ${PARTY_LABEL[party].toLowerCase()} has been engaged on this job — this will have to be chased by hand.`,
    );
  }

  await sendOnPartyThread({
    engagement,
    outreach,
    body: followUpBody({
      alert,
      outreach,
      subjectAddress: engagement.subjectAddress,
      engagement,
    }),
  });

  await prisma.complianceOutreach.update({
    where: { id: outreach.id },
    data: { lastFollowUpAt: new Date() },
  });

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("complianceFollowUpSent", {
        projectId,
        engagementId: engagement.id,
        alertId: alert.id,
        alertType: alert.type,
        party,
        contactEmail: outreach.contactEmail ?? "",
        sentBy,
      }),
    );
  });

  return requireEngagement(projectId);
}
