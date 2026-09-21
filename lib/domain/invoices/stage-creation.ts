import type { Invoice, ProjectStage } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import type { ProjectRequirementsPayload } from "@/types/project-flow";
import { resolveStageClaims } from "@/lib/projects/stage-claim";
import type { InvoiceSyncFields } from "./sync";

export type StageInvoiceCustomer = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly address: string | null;
  readonly xeroContactId: string | null;
};

export type StageInvoiceProject = {
  readonly id: string;
  readonly name: string;
  readonly totalBudget: unknown;
  readonly requirements: unknown;
  readonly customer: StageInvoiceCustomer;
};

export type CreateStageInvoiceInput = {
  readonly projectId: string;
  readonly projectStage: ProjectStage;
  readonly stageLabel: string;
  readonly issuedDate: Date;
};

export type CreateExternalStageInvoice = (input: {
  readonly project: StageInvoiceProject;
  readonly projectStage: ProjectStage;
  readonly stageLabel: string;
  readonly claim: number;
  readonly issuedDate: Date;
  readonly dueDate: Date;
  readonly gstIncluded: boolean;
}) => Promise<{
  readonly xeroInvoiceId: string;
  readonly fields: InvoiceSyncFields;
}>;

/**
 * Resolve the agreed claim, issue it through an injected Xero adapter, and
 * persist the local mirror. Xero contact/invoice construction and Blob/PDF
 * archiving stay outside this command; the business decision and idempotent
 * local write live here once for milestone hooks and future Eve callers.
 */
export async function createStageInvoice(
  input: CreateStageInvoiceInput,
  db: DomainDb,
  createExternalInvoice: CreateExternalStageInvoice,
): Promise<Invoice | null> {
  const project = (await db.project.findUnique({
    include: { customer: true },
    where: { id: input.projectId },
  })) as StageInvoiceProject | null;
  if (!project) {
    throw new DomainNotFoundError(`Project ${input.projectId} not found.`);
  }

  const requirements =
    project.requirements as ProjectRequirementsPayload | null;
  const claim = resolveStageClaims(
    requirements?.commercialsAndClaims?.paymentStages,
    Number(project.totalBudget),
  )[input.projectStage]?.claim;

  if (claim == null || !Number.isFinite(claim) || claim <= 0) {
    return null;
  }
  const dueDate = new Date(input.issuedDate);
  dueDate.setDate(dueDate.getDate() + 14);

  const external = await createExternalInvoice({
    claim,
    dueDate,
    gstIncluded: Boolean(requirements?.commercialsAndClaims?.gstIncluded),
    issuedDate: input.issuedDate,
    project,
    projectStage: input.projectStage,
    stageLabel: input.stageLabel,
  });

  try {
    return await db.invoice.create({
      data: {
        projectId: input.projectId,
        projectStage: input.projectStage,
        ...external.fields,
        xeroInvoiceId: external.xeroInvoiceId,
      },
    });
  } catch (error) {
    // The database uniqueness constraint is the second idempotency guard after
    // Xero's idempotency key. A retry returns the already-recorded claim.
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return db.invoice.findUnique({
        where: {
          projectId_projectStage: {
            projectId: input.projectId,
            projectStage: input.projectStage,
          },
        },
      });
    }
    throw error;
  }
}
