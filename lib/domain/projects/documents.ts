import { Prisma } from "@prisma/client";

import type { DomainDb } from "../db";
import { reviveRow } from "../sql-json";
import { inferFileTags, normalizeFileTags } from "../file-tags";
import {
  describeProjectFile,
  mergeDocumentsByUrl,
  type ProjectDocument,
} from "./document-tags";

/**
 * Every document the project holds, wherever it was put: uploaded to the
 * project or a milestone, attached to a compliance document (including what
 * arrived on a consultant's email), carried over from the lead, a tradie's
 * invoice, a variation's PDF. Newest first, one row per stored object.
 *
 * Authorizes nobody: the caller reads the project through its own scope, as
 * `getProjectDetail` does with `projectReadScope`, and returns nothing from
 * here unless that read found the project.
 *
 * `leadId` may be left out, and the lead's files are then found through the
 * project itself. That lets a caller start this read alongside the project
 * read instead of after it.
 */
export async function readProjectDocuments(
  project: { readonly id: string; readonly leadId?: number | null },
  db: DomainDb,
): Promise<ProjectDocument[]> {
  return describeProjectDocuments(
    project.id,
    await readProjectDocumentSources(project, db),
  );
}

// The rows each source is read as. These Prisma argument objects are the
// contract: `readProjectDocumentSources` returns exactly these shapes.
const fileRow = {
  include: {
    User: { select: { name: true } },
    milestone: { select: { name: true } },
    complianceDocument: { select: { documentType: true, label: true } },
    incident: { select: { tradie: { select: { name: true } } } },
  },
} as const;
const tradieInvoiceRow = {
  select: {
    id: true,
    documentUrl: true,
    documentName: true,
    invoiceNumber: true,
    status: true,
    createdAt: true,
    tradie: { select: { name: true } },
    enteredBy: { select: { name: true } },
    schedule: { select: { milestone: { select: { id: true, name: true } } } },
  },
} as const;
const inboxRow = {
  select: {
    id: true,
    documentUrl: true,
    documentName: true,
    receivedAt: true,
    fromAddress: true,
    tradie: { select: { name: true } },
    schedule: { select: { milestone: { select: { id: true, name: true } } } },
  },
} as const;
const variationRow = {
  select: {
    id: true,
    number: true,
    documentUrl: true,
    sentAt: true,
    createdAt: true,
    milestone: { select: { id: true, name: true } },
    raisedBy: { select: { name: true } },
  },
} as const;

/** The shapes the SQL must return, for its contract test. */
export const PROJECT_DOCUMENT_ROWS = {
  files: fileRow,
  invoices: tradieInvoiceRow,
  inbox: inboxRow,
  variations: variationRow,
} as const;

/** Everything the Documents tab is built from, before it is described. */
export type ProjectDocumentSources = {
  files: Prisma.FileGetPayload<typeof fileRow>[];
  invoices: Prisma.TradieInvoiceGetPayload<typeof tradieInvoiceRow>[];
  inbox: Prisma.TradieInvoiceInboxGetPayload<typeof inboxRow>[];
  variations: Prisma.VariationGetPayload<typeof variationRow>[];
};

/**
 * The four sources in ONE SQL statement. Through Prisma they were four
 * queries plus a statement per relation: about four round trips, one after
 * another. This is one (issue #411). Oldest first in each list.
 *
 * Files: the project's own, its milestones', its compliance documents', and
 * the lead's. With `leadId` left out, the lead is found through the project.
 */
export async function readProjectDocumentSources(
  project: { readonly id: string; readonly leadId?: number | null },
  db: DomainDb,
): Promise<ProjectDocumentSources> {
  const projectId = project.id;
  const leadFiles =
    project.leadId === undefined
      ? Prisma.sql`OR f."leadId" IN (SELECT lp."leadId" FROM "Project" lp WHERE lp.id = ${projectId})`
      : project.leadId !== null
        ? Prisma.sql`OR f."leadId" = ${project.leadId}`
        : Prisma.empty;

  const [row] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT
      (
        SELECT coalesce(jsonb_agg(
          to_jsonb(f) || jsonb_build_object(
            'User', (SELECT jsonb_build_object('name', u.name) FROM "User" u WHERE u.id = f."uploadedBy"),
            'milestone', (SELECT jsonb_build_object('name', m.name) FROM "Milestone" m WHERE m.id = f."milestoneId"),
            'complianceDocument', (
              SELECT jsonb_build_object('documentType', d."documentType", 'label', d.label)
              FROM "ComplianceDocument" d WHERE d.id = f."complianceDocumentId"
            ),
            'incident', (
              SELECT jsonb_build_object('tradie', (
                SELECT jsonb_build_object('name', t.name) FROM "Tradie" t WHERE t.id = i."tradieId"
              ))
              FROM "TradieIncident" i WHERE i.id = f."incidentId"
            )
          )
          ORDER BY f."createdAt" ASC
        ), '[]')
        FROM "File" f
        WHERE f."projectId" = ${projectId}
          OR f."milestoneId" IN (SELECT m.id FROM "Milestone" m WHERE m."projectId" = ${projectId})
          OR f."complianceDocumentId" IN (
            SELECT d.id FROM "ComplianceDocument" d
            JOIN "CertifierEngagement" e ON e.id = d."engagementId"
            WHERE e."projectId" = ${projectId}
          )
          ${leadFiles}
      ) AS files,
      (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'id', ti.id, 'documentUrl', ti."documentUrl", 'documentName', ti."documentName",
            'invoiceNumber', ti."invoiceNumber", 'status', ti.status, 'createdAt', ti."createdAt",
            'tradie', (SELECT jsonb_build_object('name', t.name) FROM "Tradie" t WHERE t.id = ti."tradieId"),
            'enteredBy', (SELECT jsonb_build_object('name', u.name) FROM "User" u WHERE u.id = ti."enteredById"),
            'schedule', (
              SELECT jsonb_build_object('milestone', (
                SELECT jsonb_build_object('id', m.id, 'name', m.name) FROM "Milestone" m WHERE m.id = s."milestoneId"
              ))
              FROM "TradieSchedule" s WHERE s.id = ti."scheduleId"
            )
          )
          ORDER BY ti."createdAt" ASC
        ), '[]')
        FROM "TradieInvoice" ti
        WHERE ti."projectId" = ${projectId} AND ti."documentUrl" IS NOT NULL
      ) AS invoices,
      (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'id', ib.id, 'documentUrl', ib."documentUrl", 'documentName', ib."documentName",
            'receivedAt', ib."receivedAt", 'fromAddress', ib."fromAddress",
            'tradie', (SELECT jsonb_build_object('name', t.name) FROM "Tradie" t WHERE t.id = ib."tradieId"),
            'schedule', (
              SELECT jsonb_build_object('milestone', (
                SELECT jsonb_build_object('id', m.id, 'name', m.name) FROM "Milestone" m WHERE m.id = s."milestoneId"
              ))
              FROM "TradieSchedule" s WHERE s.id = ib."scheduleId"
            )
          )
          ORDER BY ib."receivedAt" ASC
        ), '[]')
        FROM "TradieInvoiceInbox" ib
        WHERE ib."projectId" = ${projectId} AND ib.status::text = 'PENDING'
      ) AS inbox,
      (
        SELECT coalesce(jsonb_agg(
          jsonb_build_object(
            'id', v.id, 'number', v.number, 'documentUrl', v."documentUrl",
            'sentAt', v."sentAt", 'createdAt', v."createdAt",
            'milestone', (SELECT jsonb_build_object('id', m.id, 'name', m.name) FROM "Milestone" m WHERE m.id = v."milestoneId"),
            'raisedBy', (SELECT jsonb_build_object('name', u.name) FROM "User" u WHERE u.id = v."raisedById")
          )
          ORDER BY v."createdAt" ASC
        ), '[]')
        FROM "Variation" v
        WHERE v."projectId" = ${projectId} AND v."documentUrl" IS NOT NULL
      ) AS variations
  `;

  return {
    files: reviveRow(row.files, "File"),
    invoices: reviveRow(row.invoices, "TradieInvoice"),
    inbox: reviveRow(row.inbox, "TradieInvoiceInbox"),
    variations: reviveRow(row.variations, "Variation"),
  } as ProjectDocumentSources;
}

/** The Documents tab's rows, from its sources. Pure, so it is tested alone. */
export function describeProjectDocuments(
  projectId: string,
  { files, invoices, inbox, variations }: ProjectDocumentSources,
): ProjectDocument[] {
  const rows: ProjectDocument[] = files.map((file) =>
    describeProjectFile(file, {
      projectId,
      milestoneName: file.milestone?.name ?? null,
      uploadedBy: file.User?.name ?? null,
      compliance: file.complianceDocument,
      incidentTradieName: file.incident?.tradie.name ?? null,
    }),
  );

  for (const invoice of invoices) {
    const name =
      invoice.documentName ?? `Invoice ${invoice.invoiceNumber ?? ""}`.trim();
    const milestone = invoice.schedule?.milestone ?? null;
    rows.push({
      key: `tradie-invoice:${invoice.id}`,
      fileId: null,
      name,
      url: invoice.documentUrl!,
      fileType: null,
      size: null,
      createdAt: invoice.createdAt.toISOString(),
      uploadedBy: invoice.enteredBy?.name ?? null,
      milestoneId: milestone?.id ?? null,
      milestoneName: milestone?.name ?? null,
      source: "tradie-invoice",
      origin: "Project › Financials › Tradie invoices",
      tags: normalizeFileTags(
        ["Tradie invoice", "Financials", invoice.tradie.name],
        [
          milestone?.name,
          invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : null,
          invoice.status === "VOIDED" || invoice.status === "DELETED"
            ? "Voided"
            : null,
        ],
        inferFileTags(name, null),
      ),
      deletable: false,
    });
  }

  for (const item of inbox) {
    const milestone = item.schedule?.milestone ?? null;
    rows.push({
      key: `tradie-invoice-inbox:${item.id}`,
      fileId: null,
      name: item.documentName,
      url: item.documentUrl,
      fileType: null,
      size: null,
      createdAt: item.receivedAt.toISOString(),
      uploadedBy: item.fromAddress,
      milestoneId: milestone?.id ?? null,
      milestoneName: milestone?.name ?? null,
      source: "tradie-invoice",
      origin: "Email › Tradie invoice",
      tags: normalizeFileTags(
        ["Tradie invoice", "Received by email", "Awaiting confirmation"],
        [item.tradie.name, milestone?.name],
        inferFileTags(item.documentName, null),
      ),
      deletable: false,
    });
  }

  for (const variation of variations) {
    const label =
      variation.number !== null
        ? `V-${String(variation.number).padStart(3, "0")}`
        : "Variation";
    rows.push({
      key: `variation:${variation.id}`,
      fileId: null,
      name: `${label}.pdf`,
      url: variation.documentUrl!,
      fileType: "application/pdf",
      size: null,
      createdAt: variation.createdAt.toISOString(),
      uploadedBy: variation.raisedBy?.name ?? null,
      milestoneId: variation.milestone?.id ?? null,
      milestoneName: variation.milestone?.name ?? null,
      source: "variation",
      origin: "Project › Variations",
      tags: normalizeFileTags([
        "Variation",
        label,
        variation.milestone?.name,
        variation.sentAt ? "Sent to client" : "Not sent",
      ]),
      deletable: false,
    });
  }

  // Oldest first into the merge, so the original upload — not a later copy —
  // is the row a duplicate folds into.
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return mergeDocumentsByUrl(rows).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
