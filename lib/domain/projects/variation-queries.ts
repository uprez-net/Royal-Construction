import type {
  InvoiceStatus,
  VariationKind,
  VariationStatus,
} from "@prisma/client";

import { PROJECT_STAGE_LABELS } from "@/types/project";

import { authorizeProject } from "../access/projects";
import type { DomainDb } from "../db";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";
import { toCents, type Cents } from "../tradies/billing-rules";
import {
  formatVariationNumber,
  summarizeVariations,
  variationCharge,
  type VariationSummary,
} from "./variation-rules";

// The Variations tab: every variation on the project, as the office needs to
// see it — what it changed, who pays, and whether the invoice, the document
// and the email all landed.

export type VariationListRow = {
  readonly id: string;
  readonly number: string;
  readonly kind: VariationKind;
  readonly status: VariationStatus;
  readonly reason: string;
  readonly activityName: string | null;
  readonly stageLabel: string | null;
  /** ISO. */
  readonly raisedDate: string;
  readonly raisedByName: string | null;
  readonly previousPriceCents: Cents | null;
  readonly newPriceCents: Cents | null;
  /** The change to the activity, ex GST. */
  readonly costCents: Cents;
  /** What the client was billed inc GST; 0 for promotional. */
  readonly chargeIncGstCents: Cents;
  readonly invoiceNumber: string | null;
  readonly invoiceStatus: InvoiceStatus | null;
  readonly invoiceTotalCents: Cents | null;
  readonly invoiceAmountPaidCents: Cents | null;
  readonly documentUrl: string | null;
  /** ISO, or null when the client has not been emailed. */
  readonly sentAt: string | null;
  readonly sentTo: readonly string[];
  readonly issueError: string | null;
  /** Logged before variations priced an activity: nothing to issue. */
  readonly legacy: boolean;
  /** Something that should have landed did not. */
  readonly needsAttention: boolean;
};

export type ProjectVariations = {
  readonly projectId: string;
  readonly rows: readonly VariationListRow[];
  readonly summary: VariationSummary;
};

export async function getProjectVariations(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<ProjectVariations> {
  requireAdminPrincipal(principal);
  const project = await authorizeProject(principal, input.projectId, db);

  const variations = await db.variation.findMany({
    orderBy: [{ number: "asc" }, { requestedDate: "asc" }],
    select: {
      cost: true,
      description: true,
      documentUrl: true,
      id: true,
      invoiceAmountPaid: true,
      invoiceStatus: true,
      invoiceTotal: true,
      issueError: true,
      kind: true,
      milestone: { select: { name: true, projectStage: true } },
      newPrice: true,
      number: true,
      previousPrice: true,
      raisedBy: { select: { name: true } },
      requestedDate: true,
      sentAt: true,
      sentTo: true,
      status: true,
      xeroInvoiceId: true,
      xeroInvoiceNumber: true,
    },
    where: { projectId: project.id },
  });

  const rows = variations.map((variation): VariationListRow => {
    const legacy =
      variation.previousPrice === null || variation.newPrice === null;
    const previousPriceCents = legacy
      ? null
      : toCents(variation.previousPrice!);
    const newPriceCents = legacy ? null : toCents(variation.newPrice!);
    const charge =
      previousPriceCents !== null && newPriceCents !== null
        ? variationCharge({
            kind: variation.kind,
            newPriceCents,
            previousPriceCents,
          })
        : null;
    const approved = variation.status === "APPROVED";
    const needsAttention =
      !legacy
      && approved
      && (variation.issueError !== null
        || variation.sentAt === null
        || variation.documentUrl === null
        || (variation.kind === "CHARGEABLE" && !variation.xeroInvoiceId));
    return {
      activityName: variation.milestone?.name ?? null,
      chargeIncGstCents: charge?.chargeIncGstCents ?? 0,
      costCents: toCents(variation.cost),
      documentUrl: variation.documentUrl,
      id: variation.id,
      invoiceAmountPaidCents:
        variation.invoiceAmountPaid === null
          ? null
          : toCents(variation.invoiceAmountPaid),
      invoiceNumber: variation.xeroInvoiceNumber,
      invoiceStatus: variation.invoiceStatus,
      invoiceTotalCents:
        variation.invoiceTotal === null
          ? null
          : toCents(variation.invoiceTotal),
      issueError: variation.issueError,
      kind: variation.kind,
      legacy,
      needsAttention,
      newPriceCents,
      number: formatVariationNumber(variation.number),
      previousPriceCents,
      raisedByName: variation.raisedBy?.name ?? null,
      raisedDate: variation.requestedDate.toISOString(),
      reason: variation.description,
      sentAt: variation.sentAt?.toISOString() ?? null,
      sentTo: variation.sentTo,
      stageLabel: variation.milestone
        ? PROJECT_STAGE_LABELS[variation.milestone.projectStage]
        : null,
      status: variation.status,
    };
  });

  return {
    projectId: project.id,
    rows,
    summary: summarizeVariations(rows),
  };
}
