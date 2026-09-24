import "server-only";

import { revalidateTag } from "next/cache";

import { notifyCompliance } from "@/lib/compliance/notify";
import {
  closeComplianceIfComplete as closeComplianceIfCompleteDomain,
  recordComplianceCertificateIssued,
} from "@/lib/domain/compliance/lifecycle";
import { systemPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import { logAction } from "./actionLog";

function revalidate(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`compliance-${projectId}`, CACHE_PROFILES.SHORT);
}

export async function recordCertificateIssued(params: {
  id: string;
  projectId: string;
}): Promise<void> {
  try {
    const result = await recordComplianceCertificateIssued(
      systemPrincipal("compliance-certificate-arrival"),
      { engagementId: params.id, projectId: params.projectId },
      prisma,
    );
    if (!result.changed) return;
    revalidate(params.projectId);
    await logAction(
      createActivityLogEntry("complianceCertificateIssued", {
        projectId: params.projectId,
        engagementId: params.id,
      }),
    );
    await notifyCompliance("complianceCertificateIssued", params.projectId, {});
  } catch (error) {
    console.error(
      `Could not record the complying development certificate on ${params.projectId}`,
      error,
    );
  }
}

export async function closeComplianceIfComplete(params: {
  projectId: string;
  engagementId: string;
}): Promise<void> {
  try {
    const result = await closeComplianceIfCompleteDomain(
      systemPrincipal("compliance-document-arrival"),
      params,
      prisma,
    );
    if (!result.completed) return;
    revalidate(params.projectId);
    await logAction(
      createActivityLogEntry("complianceCompleted", {
        projectId: params.projectId,
        engagementId: params.engagementId,
      }),
    );
    await notifyCompliance("complianceCompleted", params.projectId, {});
  } catch (error) {
    console.error(
      `Could not close the compliance file on ${params.projectId}`,
      error,
    );
  }
}
