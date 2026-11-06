import type { DomainDb } from "../db";
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
 * Authorizes nobody: the caller has already read the project through its own
 * scope, as `getProjectDetail` does with `projectReadScope`.
 */
export async function readProjectDocuments(
  project: { readonly id: string; readonly leadId: number | null },
  db: DomainDb,
): Promise<ProjectDocument[]> {
  const projectId = project.id;
  const [files, invoices, inbox, variations] = await Promise.all([
    db.file.findMany({
      where: {
        OR: [
          { projectId },
          { milestone: { projectId } },
          { complianceDocument: { engagement: { projectId } } },
          ...(project.leadId !== null ? [{ leadId: project.leadId }] : []),
        ],
      },
      include: {
        User: { select: { name: true } },
        milestone: { select: { name: true } },
        complianceDocument: { select: { documentType: true, label: true } },
        incident: { select: { tradie: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.tradieInvoice.findMany({
      where: { projectId, documentUrl: { not: null } },
      select: {
        id: true,
        documentUrl: true,
        documentName: true,
        invoiceNumber: true,
        status: true,
        createdAt: true,
        tradie: { select: { name: true } },
        enteredBy: { select: { name: true } },
        schedule: {
          select: { milestone: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.tradieInvoiceInbox.findMany({
      where: { projectId, status: "PENDING" },
      select: {
        id: true,
        documentUrl: true,
        documentName: true,
        receivedAt: true,
        fromAddress: true,
        tradie: { select: { name: true } },
        schedule: {
          select: { milestone: { select: { id: true, name: true } } },
        },
      },
      orderBy: { receivedAt: "asc" },
    }),
    db.variation.findMany({
      where: { projectId, documentUrl: { not: null } },
      select: {
        id: true,
        number: true,
        documentUrl: true,
        sentAt: true,
        createdAt: true,
        milestone: { select: { id: true, name: true } },
        raisedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

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
