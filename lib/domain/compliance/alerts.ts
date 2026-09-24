import {
  ComplianceAlertSource,
  ComplianceAlertStatus,
  ComplianceAlertType,
} from "@prisma/client";

import { authorizeComplianceMutation } from "../access/compliance";
import type { DomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import type { DomainPrincipal } from "../principal";
import { ensureDevelopmentApplicationDocuments } from "./documents";

export const COMPLIANCE_ALERT_TITLE: Readonly<
  Record<ComplianceAlertType, string>
> = {
  [ComplianceAlertType.STALE_TITLE_SEARCH]: "Title search does not name the owners",
  [ComplianceAlertType.DA_APPROVAL_REQUIRED]: "Development approval required",
  [ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED]: "Planning certificate taking longer than usual",
  [ComplianceAlertType.SURVEYOR_RESPONSE_OVERDUE]: "Surveyor response pending — send a follow up",
  [ComplianceAlertType.ARCHITECT_PLANS_OVERDUE]: "Preliminary plans pending — follow up with the architect",
  [ComplianceAlertType.ARCHITECT_REVISION_OVERDUE]: "Client revisions pending — follow up with the architect",
  [ComplianceAlertType.BASIX_RESPONSE_OVERDUE]: "BASIX certificate pending — send a follow up",
  [ComplianceAlertType.BUSHFIRE_RESPONSE_OVERDUE]: "Bushfire assessment pending — send a follow up",
  [ComplianceAlertType.STRUCTURAL_RESPONSE_OVERDUE]: "Structural engineer response pending — send a follow up",
  [ComplianceAlertType.WATER_AUTHORITY_RESPONSE_OVERDUE]: "Water servicing approval pending — send a follow up",
  [ComplianceAlertType.TRAFFIC_RESPONSE_OVERDUE]: "Traffic control plan pending — send a follow up",
  [ComplianceAlertType.WASTE_MANAGEMENT_PLAN_OVERDUE]: "Waste management plan pending — follow up with the architect",
  [ComplianceAlertType.DEVELOPER_RESPONSE_OVERDUE]: "Developer approval pending — send a follow up",
  [ComplianceAlertType.BUSHFIRE_REVISION_OVERDUE]: "Revised bushfire report pending — follow up with the consultant",
  [ComplianceAlertType.ROAD_OPENING_DELAYED]: "Road opening approval taking longer than usual",
  [ComplianceAlertType.LONG_SERVICE_LEVY_DELAYED]: "Long service levy receipt outstanding",
  [ComplianceAlertType.MINE_SUBSIDENCE_DELAYED]: "Mine subsidence approval taking longer than usual",
  [ComplianceAlertType.DA_DETERMINATION_OVERDUE]: "Development application still undetermined",
  [ComplianceAlertType.CDC_DETERMINATION_OVERDUE]: "CDC still undetermined",
  [ComplianceAlertType.CC_DETERMINATION_OVERDUE]: "Construction certificate still undetermined",
  [ComplianceAlertType.DEVELOPER_PLANS_OVERDUE]: "Developer approval of the plans pending — send a follow up",
  [ComplianceAlertType.CDC_DOWNLOAD_READY]: "CDC approved — ready to download",
  [ComplianceAlertType.CC_DOWNLOAD_READY]: "Construction certificate approved — ready to download",
  [ComplianceAlertType.DA_DOWNLOAD_READY]: "Development consent granted — ready to download",
};

export async function raiseComplianceAlert(
  principal: DomainPrincipal,
  input: {
    projectId: string;
    engagementId: string;
    type: ComplianceAlertType;
    raisedBySource?: ComplianceAlertSource | null;
    detail?: string | null;
  },
  db: DomainDb,
) {
  await authorizeComplianceMutation(principal, input.projectId, db);
  const engagement = await db.certifierEngagement.findFirst({
    where: { id: input.engagementId, projectId: input.projectId },
    select: { id: true },
  });
  if (!engagement) {
    throw new DomainNotFoundError("That compliance file is not on this project.");
  }
  if (input.type === ComplianceAlertType.DA_APPROVAL_REQUIRED) {
    await ensureDevelopmentApplicationDocuments(input.engagementId, db);
  }
  const open = await db.complianceAlert.findFirst({
    where: {
      engagementId: input.engagementId,
      type: input.type,
      status: ComplianceAlertStatus.OPEN,
    },
    select: { id: true },
  });
  if (open) return { alertId: open.id, created: false as const };
  const alert = await db.complianceAlert.create({
    data: {
      engagementId: input.engagementId,
      type: input.type,
      raisedBySource: input.raisedBySource ?? null,
      detail: input.detail ?? null,
    },
    select: { id: true },
  });
  return { alertId: alert.id, created: true as const };
}

export async function resolveComplianceAlertBySystem(
  principal: DomainPrincipal,
  input: {
    projectId: string;
    engagementId: string;
    type: ComplianceAlertType;
    resolutionNote: string;
  },
  db: DomainDb,
) {
  await authorizeComplianceMutation(principal, input.projectId, db);
  if (!input.resolutionNote.trim()) {
    throw new DomainValidationError("A resolution note is required.", "resolutionNote");
  }
  const claim = await db.complianceAlert.updateMany({
    where: {
      engagementId: input.engagementId,
      engagement: { projectId: input.projectId },
      type: input.type,
      status: ComplianceAlertStatus.OPEN,
    },
    data: {
      status: ComplianceAlertStatus.RESOLVED,
      resolvedAt: new Date(),
      resolutionNote: input.resolutionNote.trim(),
    },
  });
  return claim.count > 0;
}

export async function resolveComplianceAlert(
  principal: DomainPrincipal,
  input: {
    projectId: string;
    alertId: string;
    resolutionNote: string;
  },
  db: DomainDb,
) {
  await authorizeComplianceMutation(principal, input.projectId, db);
  if (!input.resolutionNote.trim()) {
    throw new DomainValidationError("A resolution note is required.", "resolutionNote");
  }
  const alert = await db.complianceAlert.findFirst({
    where: { id: input.alertId, engagement: { projectId: input.projectId } },
    select: { id: true, engagementId: true, type: true, status: true },
  });
  if (!alert) throw new DomainNotFoundError("No such compliance alert.");
  const claim = await db.complianceAlert.updateMany({
    where: { id: alert.id, status: ComplianceAlertStatus.OPEN },
    data: {
      status: ComplianceAlertStatus.RESOLVED,
      resolvedById: principal.kind === "user" ? principal.userId : null,
      resolvedAt: new Date(),
      resolutionNote: input.resolutionNote.trim(),
    },
  });
  if (claim.count === 0 && alert.status !== ComplianceAlertStatus.RESOLVED) {
    throw new DomainTransitionError("That compliance alert changed; refresh and retry.");
  }
  return { alert, changed: claim.count === 1 };
}
