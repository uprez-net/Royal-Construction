import {
  ComplianceAlertSource,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  Prisma,
} from "@prisma/client";

import {
  complianceDocumentLabel,
  DA_DOCUMENTS,
} from "@/constants/complianceDocuments";
import { authorizeComplianceMutation } from "../access/compliance";
import type { TransactionalDomainDb } from "../db";
import type { DomainPrincipal } from "../principal";
import {
  comparableName,
  matchRejection,
  type RejectionCandidate,
} from "./rejection-matching";

export type AssessorKind = "council" | "certifier";
export type IssuedItemOutcome = {
  created: number;
  rejected: number;
  unmatched: string[];
};

const ISSUED_ITEM_TYPES: ReadonlySet<ComplianceDocumentType> = new Set([
  ComplianceDocumentType.CHECKLIST_ITEM,
  ComplianceDocumentType.DA_ITEM,
]);

const ASSESSOR_ROWS: Readonly<
  Record<
    AssessorKind,
    {
      itemType: ComplianceDocumentType;
      rejectable: readonly ComplianceDocumentType[];
      source: ComplianceAlertSource;
    }
  >
> = {
  council: {
    itemType: ComplianceDocumentType.DA_ITEM,
    rejectable: [
      ComplianceDocumentType.DA_ITEM,
      ...DA_DOCUMENTS.map((document) => document.type),
    ],
    source: ComplianceAlertSource.COUNCIL,
  },
  certifier: {
    itemType: ComplianceDocumentType.CHECKLIST_ITEM,
    rejectable: [ComplianceDocumentType.CHECKLIST_ITEM],
    source: ComplianceAlertSource.CERTIFIER,
  },
};

export async function applyAssessorCorrespondence(
  principal: DomainPrincipal,
  input: {
    projectId: string;
    engagementId: string;
    assessor: AssessorKind;
    requested: { label: string; description: string }[];
    rejected: { documentName: string; reason: string }[];
  },
  db: TransactionalDomainDb,
): Promise<IssuedItemOutcome> {
  await authorizeComplianceMutation(principal, input.projectId, db);
  const rows = ASSESSOR_ROWS[input.assessor];
  return db.$transaction(
    async (tx) => {
      const outcome: IssuedItemOutcome = {
        created: 0,
        rejected: 0,
        unmatched: [],
      };
      if (input.requested.length > 0) {
        const existing = await tx.complianceDocument.findMany({
          where: {
            engagementId: input.engagementId,
            documentType: rows.itemType,
          },
          select: { label: true, order: true },
          orderBy: { order: "desc" },
        });
        const seen = new Set(
          existing
            .map((row) => comparableName(row.label ?? ""))
            .filter(Boolean),
        );
        let order = (existing[0]?.order ?? 0) + 1;
        for (const item of input.requested) {
          const key = comparableName(item.label);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          await tx.complianceDocument.create({
            data: {
              engagementId: input.engagementId,
              documentType: rows.itemType,
              status: ComplianceDocumentStatus.PENDING,
              label: item.label,
              order: order++,
              detail: item.description
                ? ({ description: item.description } as Prisma.InputJsonValue)
                : Prisma.DbNull,
            },
          });
          outcome.created += 1;
        }
      }

      if (input.rejected.length > 0) {
        const stored = await tx.complianceDocument.findMany({
          where: {
            engagementId: input.engagementId,
            documentType: { in: [...rows.rejectable] },
          },
          select: { id: true, documentType: true, label: true, order: true },
        });
        const candidates: RejectionCandidate[] = stored.map((row) => ({
          id: row.id,
          names: [
            row.label ?? "",
            complianceDocumentLabel(row.documentType, row.label),
            row.documentType.replace(/_/g, " "),
          ]
            .map(comparableName)
            .filter(Boolean),
          order: ISSUED_ITEM_TYPES.has(row.documentType) ? row.order : null,
        }));
        for (const rejection of input.rejected) {
          const documentId = matchRejection(rejection.documentName, candidates);
          if (!documentId) {
            outcome.unmatched.push(rejection.documentName);
            continue;
          }
          await tx.complianceDocument.update({
            where: { id: documentId },
            data: {
              status: ComplianceDocumentStatus.PENDING,
              rejectionReason: rejection.reason,
              rejectedBySource: rows.source,
            },
          });
          outcome.rejected += 1;
        }
      }
      return outcome;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
