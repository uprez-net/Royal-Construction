import "server-only";

import type { CompliancePartyType } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { PARTY_LABEL } from "@/constants/complianceDocuments";
import { notifyCompliance } from "@/lib/compliance/notify";
import { sendOnPartyThread } from "@/lib/compliance/party-mail";
import {
  recordCompliancePartySelfSupplied,
  sendComplianceOutreach,
  sendCompliancePartyReply,
} from "@/lib/domain/compliance/outreach";
import type { DomainPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import { sanitizeLeadNotesHtml } from "@/lib/rich-text/lead-notes";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  type CertifierEngagementDetail,
} from "@/types/compliance";
import type {
  PartyReplyInput,
  StartPartyOutreachInput,
} from "@/utils/validators/compliance";
import { logAction } from "./actionLog";

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

/** App adapter for the domain-owned opening outreach command. */
export async function startPartyOutreach(
  principal: DomainPrincipal,
  projectId: string,
  input: StartPartyOutreachInput,
  idempotencyKey?: string,
): Promise<CertifierEngagementDetail> {
  const result = await sendComplianceOutreach(
    principal,
    {
      ...input,
      body: sanitizeLeadNotesHtml(input.body),
      idempotencyKey,
      projectId,
    },
    prisma,
    sendOnPartyThread,
  );
  const engagement = await requireEngagement(projectId);
  const outreach = engagement.outreaches.find(
    (candidate) => candidate.id === result.outreachId,
  );

  after(async () => {
    revalidateEngagement(projectId);
    if (result.alreadySent || !outreach) return;
    await logAction(
      createActivityLogEntry("complianceOutreachSent", {
        projectId,
        engagementId: engagement.id,
        outreachId: outreach.id,
        party: outreach.party,
        contactEmail: result.recipient,
        refToken: outreach.refToken,
        attachmentCount: result.attachmentCount,
      }),
    );
    await notifyCompliance("complianceOutreachSent", projectId, {
      party: PARTY_LABEL[outreach.party],
      contactEmail: result.recipient,
      attachmentCount: result.attachmentCount,
    });
  });

  return engagement;
}

/** Records the no-email alternative through the same domain access boundary. */
export async function recordPartySelfSupplied(
  principal: DomainPrincipal,
  projectId: string,
  party: CompliancePartyType,
  recordedBy: string,
): Promise<CertifierEngagementDetail> {
  const result = await recordCompliancePartySelfSupplied(
    principal,
    { party, projectId },
    prisma,
  );

  after(async () => {
    revalidateEngagement(projectId);
    if (!result.created) return;
    await logAction(
      createActivityLogEntry("complianceOutreachSelfSupplied", {
        projectId,
        engagementId: result.outreach.engagementId,
        outreachId: result.outreach.id,
        party,
        recordedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

/** Sends and records a party-thread reply behind a durable domain key. */
export async function sendPartyReply(
  principal: DomainPrincipal,
  projectId: string,
  outreachId: string,
  input: Omit<PartyReplyInput, "outreachId">,
  idempotencyKey?: string,
): Promise<CertifierEngagementDetail> {
  const body =
    input.bodyFormat === "html"
      ? sanitizeLeadNotesHtml(input.body)
      : `<p>${input.body
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/\n/g, "<br/>")}</p>`;

  await sendCompliancePartyReply(
    principal,
    {
      attachments: input.attachments,
      body,
      extraAttachmentIds: input.extraAttachmentIds ?? [],
      idempotencyKey,
      outreachId,
      projectId,
    },
    prisma,
    sendOnPartyThread,
  );

  after(() => revalidateEngagement(projectId));
  return requireEngagement(projectId);
}
