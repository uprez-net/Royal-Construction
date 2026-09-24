import {
  CertifierEngagementStatus,
  ComplianceDocumentStatus,
  GraphMailbox,
  Prisma,
} from "@prisma/client";

import { REQUIRED_COMPLIANCE_DOCUMENTS } from "@/constants/complianceDocuments";
import { generateCertifierRefToken } from "@/lib/graph/certifier-subject";
import { certifierEngagementInclude } from "@/types/compliance";

import { authorizeComplianceAccess } from "../access/compliance";
import type { DomainDb, TransactionalDomainDb } from "../db";
import type { DomainPrincipal } from "../principal";

export type StartComplianceInput = {
  readonly projectId: string;
  readonly subjectAddress: string;
  readonly certifierEmail: string;
  readonly certifierName?: string | null;
  readonly certifierPhone?: string | null;
};

/** Read one engagement through the shared compliance scope. */
export async function getComplianceEngagement(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
) {
  await authorizeComplianceAccess(principal, projectId, db, {
    requireEngagement: false,
  });
  return db.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
}

/**
 * Open a compliance file and move a draft project forward atomically.
 *
 * The unique project relation makes retries idempotent. Serializable isolation
 * also covers two tabs both observing that the engagement does not exist.
 */
export async function startComplianceEngagement(
  principal: DomainPrincipal,
  input: StartComplianceInput,
  db: TransactionalDomainDb,
) {
  await authorizeComplianceAccess(principal, input.projectId, db, {
    requireEngagement: false,
  });

  return db.$transaction(
    async (tx) => {
      const existing = await tx.certifierEngagement.findUnique({
        where: { projectId: input.projectId },
        include: certifierEngagementInclude,
      });
      if (existing) return { alreadyStarted: true as const, engagement: existing };

      const engagement = await tx.certifierEngagement.create({
        data: {
          projectId: input.projectId,
          refToken: generateCertifierRefToken(),
          subjectAddress: input.subjectAddress,
          certifierName: input.certifierName ?? null,
          certifierEmail: input.certifierEmail,
          certifierPhone: input.certifierPhone ?? null,
          graphMailbox: GraphMailbox.ADMIN,
          status: CertifierEngagementStatus.COLLECTING_DOCS,
          documents: {
            create: REQUIRED_COMPLIANCE_DOCUMENTS.map((document, order) => ({
              documentType: document.type,
              order,
              status: ComplianceDocumentStatus.PENDING,
            })),
          },
        },
        include: certifierEngagementInclude,
      });
      await tx.project.updateMany({
        where: {
          id: input.projectId,
          status: { in: ["DRAFT", "NEEDS_ATTENTION"] },
        },
        data: { status: "COMPLIANCE_STARTED" },
      });
      return { alreadyStarted: false as const, engagement };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
