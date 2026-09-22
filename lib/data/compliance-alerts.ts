import "server-only";

import type {
  ComplianceAlertSource,
  ComplianceAlertType,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { notifyCompliance } from "@/lib/compliance/notify";
import {
  COMPLIANCE_ALERT_TITLE,
  raiseComplianceAlert as raiseComplianceAlertDomain,
  resolveComplianceAlert as resolveComplianceAlertDomain,
  resolveComplianceAlertBySystem as resolveComplianceAlertBySystemDomain,
} from "@/lib/domain/compliance/alerts";
import {
  systemPrincipal,
  type DomainPrincipal,
} from "@/lib/domain/principal";
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

export async function complianceAlertTitle(
  type: ComplianceAlertType,
): Promise<string> {
  return COMPLIANCE_ALERT_TITLE[type];
}

async function reloadEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
  if (!engagement) throw new Error(`Project ${projectId} has no compliance file.`);
  return engagement;
}

export async function raiseComplianceAlert(params: {
  projectId: string;
  engagementId: string;
  type: ComplianceAlertType;
  raisedBySource?: ComplianceAlertSource | null;
  detail?: string | null;
  principal?: DomainPrincipal;
}): Promise<{ alertId: string; created: boolean }> {
  const result = await raiseComplianceAlertDomain(
    params.principal ?? systemPrincipal("compliance-automation"),
    params,
    prisma,
  );
  if (!result.created) return result;

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceAlertRaised", {
        projectId: params.projectId,
        engagementId: params.engagementId,
        alertId: result.alertId,
        alertType: params.type,
        raisedBy: params.raisedBySource ?? "an admin",
      }),
    );
    await notifyCompliance("complianceAlertRaised", params.projectId, {
      alertId: result.alertId,
      alertTitle: COMPLIANCE_ALERT_TITLE[params.type],
      detail: params.detail ?? "",
    });
  });
  return result;
}

export async function resolveComplianceAlertBySystem(params: {
  projectId: string;
  engagementId: string;
  type: ComplianceAlertType;
  resolutionNote: string;
  principal?: DomainPrincipal;
}): Promise<boolean> {
  const changed = await resolveComplianceAlertBySystemDomain(
    params.principal ?? systemPrincipal("compliance-automation"),
    params,
    prisma,
  );
  if (!changed) return false;

  after(async () => {
    revalidateEngagement(params.projectId);
    await logAction(
      createActivityLogEntry("complianceAlertResolved", {
        projectId: params.projectId,
        engagementId: params.engagementId,
        alertId: params.type,
        alertType: params.type,
        resolvedBy: "the system",
      }),
    );
  });
  return true;
}

export async function resolveComplianceAlert(params: {
  principal: DomainPrincipal;
  projectId: string;
  alertId: string;
  resolvedByName: string;
  resolutionNote: string;
}): Promise<CertifierEngagementDetail> {
  const result = await resolveComplianceAlertDomain(
    params.principal,
    params,
    prisma,
  );
  if (result.changed) {
    after(async () => {
      revalidateEngagement(params.projectId);
      await logAction(
        createActivityLogEntry("complianceAlertResolved", {
          projectId: params.projectId,
          engagementId: result.alert.engagementId,
          alertId: result.alert.id,
          alertType: result.alert.type,
          resolvedBy: params.resolvedByName,
        }),
      );
    });
  }
  return reloadEngagement(params.projectId);
}
