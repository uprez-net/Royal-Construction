import { ComplianceAlertStatus, ComplianceAlertType } from "@prisma/client";

import { authorizeComplianceMutation } from "../access/compliance";
import type { TransactionalDomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import type { DomainPrincipal } from "../principal";
import { certifierEngagementInclude } from "@/types/compliance";
import { ensureDevelopmentApplicationDocuments } from "./documents";

export async function setDevelopmentApplicationRequired(
  principal: DomainPrincipal,
  input: { projectId: string; required: boolean },
  db: TransactionalDomainDb,
) {
  const access = await authorizeComplianceMutation(
    principal,
    input.projectId,
    db,
  );
  const engagementId = access.engagement?.id;
  if (!engagementId) {
    throw new DomainNotFoundError(
      "No certifier engagement has been started for this project.",
    );
  }
  return db.$transaction(async (tx) => {
    await tx.certifierEngagement.update({
      where: { id: engagementId },
      data: { developmentApplicationRequired: input.required },
    });
    let alertCreated = false;
    if (input.required) {
      await ensureDevelopmentApplicationDocuments(engagementId, tx);
      const open = await tx.complianceAlert.findFirst({
        where: {
          engagementId,
          type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
          status: ComplianceAlertStatus.OPEN,
        },
        select: { id: true },
      });
      if (!open) {
        await tx.complianceAlert.create({
          data: {
            engagementId,
            type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
            detail:
              "The compliance file was marked as needing a Development Application. Collect and lodge the DA before continuing the certifier checklist.",
          },
        });
        alertCreated = true;
      }
    }
    const engagement = await tx.certifierEngagement.findUnique({
      where: { id: engagementId },
      include: certifierEngagementInclude,
    });
    if (!engagement)
      throw new DomainNotFoundError("Compliance file not found.");
    return { alertCreated, engagement };
  });
}
