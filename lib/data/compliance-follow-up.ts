import "server-only";

import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { sendOnPartyThread } from "@/lib/compliance/party-mail";
import { sendComplianceFollowUp as sendComplianceFollowUpDomain } from "@/lib/domain/compliance/outreach";
import type { DomainPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  type CertifierEngagementDetail,
} from "@/types/compliance";
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
  if (!engagement) throw new Error("This project has no compliance file yet.");
  return engagement;
}

/** App adapter for the domain-owned, durable compliance chase. */
export async function sendComplianceFollowUp(
  projectId: string,
  alertId: string,
  principal: DomainPrincipal,
  sentBy: string,
  idempotencyKey?: string,
): Promise<CertifierEngagementDetail> {
  const result = await sendComplianceFollowUpDomain(
    principal,
    { alertId, idempotencyKey, projectId },
    prisma,
    sendOnPartyThread,
  );

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("complianceFollowUpSent", {
        projectId,
        engagementId: result.engagementId,
        alertId: result.alertId,
        alertType: result.alertType,
        party: result.party,
        contactEmail: result.recipient,
        sentBy,
      }),
    );
  });

  return requireEngagement(projectId);
}
