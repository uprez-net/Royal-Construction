"use server";

import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { requireComplianceAccess } from "@/lib/compliance/access";
import { setDevelopmentApplicationRequired as setDevelopmentApplicationRequiredDomain } from "@/lib/domain/compliance/development-application";
import { userPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import type { CertifierEngagementDetail } from "@/types/compliance";
import { logAction } from "./actionLog";

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

export async function setDevelopmentApplicationRequired(params: {
  projectId: string;
  required: boolean;
  answeredByName?: string | null;
}): Promise<CertifierEngagementDetail> {
  const { user } = await requireComplianceAccess(params.projectId);
  const result = await setDevelopmentApplicationRequiredDomain(
    userPrincipal(user),
    params,
    prisma,
  );
  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceDevelopmentApplicationRequirementSet", {
        projectId: params.projectId,
        engagementId: result.engagement.id,
        required: params.required,
        answeredBy: params.answeredByName ?? null,
      }),
    );
  });
  return result.engagement;
}
