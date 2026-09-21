import { OutboxEventKind, type Invoice, type ProjectStage } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainNotFoundError } from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
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
 *
 * The issuance runs behind a durable intent keyed on the project and stage —
 * one claim per stage is the business rule, so that is the idempotency key.
 * The intent is written before Xero is called, which is the difference that
 * matters: previously an accepted invoice whose response was lost left no
 * local trace at all, and the only thing that recovered it was Xero honouring
 * the same idempotency key on a later milestone completion. Now the attempt
 * itself is a row somebody can find. Deliberately NOT repeatable: a duplicate
 * progress claim is money in front of a customer.
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

  // The provider call and the local mirror land inside the one intent, so a
  // claim that reached Xero is never recorded as un-issued.
  const { result } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `invoice-stage:${input.projectId}:${input.projectStage}`,
      kind: OutboxEventKind.INVOICE_STAGE_ISSUE,
      payload: {
        claim,
        projectId: input.projectId,
        projectStage: input.projectStage,
        stageLabel: input.stageLabel,
      },
    },
    async () => {
      const external = await createExternalInvoice({
        claim,
        dueDate,
        gstIncluded: Boolean(requirements?.commercialsAndClaims?.gstIncluded),
        issuedDate: input.issuedDate,
        project,
        projectStage: input.projectStage,
        stageLabel: input.stageLabel,
      });
      const invoice = await persistStageInvoice(input, external, db);
      // Only ids go in the intent's result. A replay re-reads the invoice row
      // rather than reconstructing Decimals and Dates out of stored JSON,
      // which is the kind of round trip that quietly changes a total.
      return {
        invoiceId: invoice?.id ?? null,
        xeroInvoiceId: external.xeroInvoiceId,
      };
    },
  );

  if (!result.invoiceId) return null;
  return db.invoice.findUnique({ where: { id: result.invoiceId } });
}

/**
 * Write the local mirror, treating the uniqueness constraint as the second
 * idempotency guard after Xero's own key: a retry returns the recorded claim
 * rather than failing on a row that already says what we wanted it to say.
 */
async function persistStageInvoice(
  input: CreateStageInvoiceInput,
  external: { xeroInvoiceId: string; fields: InvoiceSyncFields },
  db: DomainDb,
): Promise<Invoice | null> {
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
    if (error instanceof Error && "code" in error && error.code === "P2002") {
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
