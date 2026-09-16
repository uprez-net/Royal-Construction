"use server";

import { ComplianceAlertType } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  ComplianceDomainError,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { raiseComplianceAlert } from "@/lib/data/compliance-alerts";
import { getCertifierEngagement } from "@/lib/data/compliance";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import type { CertifierEngagementDetail } from "@/types/compliance";
import { logAction } from "./actionLog";

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

/**
 * Records the answer to whether this compliance file needs a DA.
 *
 * A true answer raises the existing DA approval alert. That alert is also the
 * source of truth that opens the DA stage, so the answer and the visible DA
 * workflow cannot drift apart. A false answer is still stored explicitly and
 * leaves the CDC path untouched.
 */
export async function setDevelopmentApplicationRequired(params: {
  projectId: string;
  required: boolean;
  answeredByName?: string | null;
}): Promise<CertifierEngagementDetail> {
  const access = await requireComplianceAccess(params.projectId);
  const engagementId = access.engagement?.id;
  if (!engagementId) {
    throw new ComplianceDomainError(
      "No certifier engagement has been started for this project.",
      "NOT_FOUND",
      404,
    );
  }

  await prisma.certifierEngagement.update({
    where: { id: engagementId },
    data: { developmentApplicationRequired: params.required },
  });

  if (params.required) {
    await raiseComplianceAlert({
      projectId: params.projectId,
      engagementId,
      type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
      detail:
        "The compliance file was marked as needing a Development Application. Collect and lodge the DA before continuing the certifier checklist.",
    });
  }

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceDevelopmentApplicationRequirementSet", {
        projectId: params.projectId,
        engagementId,
        required: params.required,
        answeredBy: params.answeredByName ?? null,
      }),
    );
  });

  const engagement = await getCertifierEngagement(params.projectId);
  if (!engagement) {
    throw new Error("The compliance file could not be reloaded.");
  }
  return engagement;
}
