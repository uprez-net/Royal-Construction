import {
  complianceDocumentLabel,
  isApprovalParty,
  partyDeliverables,
} from "@/constants/complianceDocuments";
import type { CompliancePartyType } from "@prisma/client";

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
