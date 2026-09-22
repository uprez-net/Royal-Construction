// Shared party-email content policy.
import {
  complianceDocumentLabel,
  documentTypesForParty,
  isApprovalParty,
  isNotRequired,
  PARTY_LABEL,
  partyDeliverables,
} from "@/constants/complianceDocuments";
import {
  ComplianceAlertType,
  CompliancePartyType,
} from "@prisma/client";
import {
  outstandingRevision,
  type CertifierEngagementDetail,
  type ComplianceAlertRecord,
  type ComplianceOutreachDetail,
} from "@/types/compliance";

export type OutreachClientDetails = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

function escapeEmailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clientDetailsBlock(client: OutreachClientDetails): string {
  const rows: [string, string][] = [
    ["Name", client.name],
    ["Email", client.email ?? ""],
    ["Phone", client.phone ?? ""],
    ["Address", client.address ?? ""],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return [
    "<p>Please arrange a time to sit down with the owners and work through what they are after before you start drawing. Their details:</p>",
    `<ul>${rows
      .map(
        ([label, value]) =>
          `<li><strong>${escapeEmailHtml(label)}:</strong> ${escapeEmailHtml(value)}</li>`,
      )
      .join("")}</ul>`,
    "<p>We can set that meeting up from our end if it is easier — say the word and we will send an invitation to you both.</p>",
  ].join("\n");
}

function developerApprovalBody(params: {
  greeting: string;
  subjectAddress: string;
  estate: string | null;
}): string {
  const { greeting, subjectAddress, estate } = params;

  return [
    `<p>${greeting}</p>`,
    `<p>We are building at <strong>${escapeEmailHtml(subjectAddress)}</strong>${
      estate ? ` in <strong>${escapeEmailHtml(estate)}</strong>` : ""
    }, and the lot is subject to your bushfire approval before we lodge.</p>`,
    "<p>The bushfire attack level assessment is attached, along with the plans and the survey it was prepared against.</p>",
    "<p>Could you let us know whether you approve it? A reply saying approved or not approved is all we need — if it is not approved, please tell us what has to change, and we will send that straight to the consultant.</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ].join("\n");
}

/** Builds the editable opening email shown in the party outreach modal. */
export function buildPartyOutreachBody(params: {
  party: CompliancePartyType;
  contactName: string | null;
  subjectAddress: string;
  estate?: string | null;
  client?: OutreachClientDetails | null;
}): string {
  const greeting = params.contactName
    ? `Hi ${escapeEmailHtml(params.contactName)},`
    : "Hi,";

  if (isApprovalParty(params.party)) {
    return developerApprovalBody({
      greeting,
      subjectAddress: params.subjectAddress,
      estate: params.estate ?? null,
    });
  }

  const wanted = partyDeliverables(params.party).map((type) =>
    complianceDocumentLabel(type),
  );

  return [
    `<p>${greeting}</p>`,
    `<p>We are starting work at <strong>${escapeEmailHtml(params.subjectAddress)}</strong> and would like to engage you on it.</p>`,
    "<p>Could you prepare and send through:</p>",
    `<ul>${wanted.map((label) => `<li>${escapeEmailHtml(label)}</li>`).join("")}</ul>`,
    params.client ? clientDetailsBlock(params.client) : "",
    "<p>Anything you need to work from is attached.</p>",
    "<p>Please keep the reference in the subject line on any reply, so it stays with this job.</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Builds the editable email that sends a certifier rejection to its producer. */
export function buildPartyRevisionBody(params: {
  contactName: string | null;
  subjectAddress: string;
  documentLabel: string;
  rejectionReason: string;
}): string {
  const greeting = params.contactName
    ? `Hi ${escapeEmailHtml(params.contactName)},`
    : "Hi,";

  return [
    `<p>${greeting}</p>`,
    `<p>The certifier has reviewed the <strong>${escapeEmailHtml(params.documentLabel)}</strong> for <strong>${escapeEmailHtml(params.subjectAddress)}</strong> and asked for a revision:</p>`,
    `<blockquote><p>${escapeEmailHtml(params.rejectionReason)}</p></blockquote>`,
    "<p>The reviewed copy is attached. Could you please revise the document to address this feedback and reply on this thread with the updated version?</p>",
    "<p>Kind regards,<br/>Royal Constructions</p>",
  ].join("\n");
}

function isSuppliedOnFile(
  engagement: CertifierEngagementDetail,
  documentType: Parameters<typeof complianceDocumentLabel>[0],
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

/** Builds the specific chase copy for an open compliance alert. */
export function buildComplianceFollowUpBody(params: {
  alert: ComplianceAlertRecord;
  outreach: ComplianceOutreachDetail;
  subjectAddress: string;
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
        alert.detail ? `<p>${escapeEmailHtml(alert.detail)}</p>` : "",
        "<p>Could you re-order the search and send the updated copy through? The land registry has most likely not been updated since settlement.</p>",
        ...sign,
      ]
        .filter(Boolean)
        .join("\n");

    case ComplianceAlertType.ARCHITECT_REVISION_OVERDUE: {
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
      return [
        `<p>${greeting}</p>`,
        `<p>Following up on the waste management plan for ${address}.</p>`,
        "<p>Could you let us know where it is up to, or when we can expect it? The application cannot be lodged without it.</p>",
        ...sign,
      ].join("\n");

    default: {
      const deliverables =
        outreach.party === CompliancePartyType.SURVEYOR
          ? documentTypesForParty(outreach.party)
          : partyDeliverables(outreach.party);
      const outstanding = deliverables.filter(
        (type) => !isSuppliedOnFile(params.engagement, type, outreach),
      );
      if (outstanding.length === 0) {
        throw new Error(
          `Everything we asked ${PARTY_LABEL[outreach.party].toLowerCase()} for is on the file — there is nothing left to chase. The alert closes on tonight's sweep.`,
        );
      }
      const wanted = outstanding.map((type) =>
        complianceDocumentLabel(type),
      );
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
