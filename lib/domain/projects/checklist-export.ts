import { ChecklistSignaturePurpose, ChecklistStatus } from "@prisma/client";

import { PROJECT_STAGE_LABELS } from "@/types/project";

import { authorizeProject } from "../access/projects";
import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainSideEffectError,
  DomainStaleVersionError,
  isDomainError,
} from "../errors";
import type {
  ChecklistDocumentData,
  ChecklistDocumentRenderPort,
} from "../ports/checklist";
import type { DomainPrincipal } from "../principal";
import { ISSUE_STATUS_LABELS, isBlockingIssue } from "./checklist-rules";
import {
  checklistActor,
  loadChecklist,
  requireReviewerName,
  requireSignature,
} from "./checklist-common";

// The downloaded checklist (issue #420): the client's own handover document,
// filled in, with the reviewer's name and signature.
//
// Every checklist can be downloaded, including the five with no rows yet,
// which print as a blank, labelled template. Only a CLOSED checklist prints as
// final; anything else is marked as a draft on every page, so a signed export
// of an inspection still in progress cannot pass for a completed one.
// Downloading never closes anything.

export type ExportChecklistInput = {
  readonly projectId: string;
  readonly checklistId: string;
  readonly reviewerName: string;
  readonly signatureDataUrl: string;
};

export type ExportedChecklist = {
  readonly exportId: string;
  readonly filename: string;
  readonly final: boolean;
  readonly pdf: Uint8Array;
};

function fileSafe(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** What the document prints, from the checklist as it stands. */
export async function checklistDocumentData(
  input: { readonly projectId: string; readonly checklistId: string },
  signer: {
    readonly reviewerName: string;
    readonly signatureDataUrl: string;
    readonly signedAt: Date;
  },
  db: DomainDb,
): Promise<ChecklistDocumentData> {
  const row = await db.projectChecklist.findFirstOrThrow({
    include: {
      issues: {
        include: { assignedTradie: { select: { name: true } } },
        orderBy: { number: "asc" },
      },
      items: { orderBy: { order: "asc" } },
      project: { select: { buildingType: true, location: true, name: true } },
    },
    where: { id: input.checklistId, projectId: input.projectId },
  });
  const itemsById = new Map(row.items.map((item) => [item.id, item]));

  const sections: {
    section: string;
    items: ChecklistDocumentData["sections"][number]["items"][number][];
  }[] = [];
  for (const item of row.items) {
    let group = sections.at(-1);
    if (!group || group.section !== item.section) {
      group = { items: [], section: item.section };
      sections.push(group);
    }
    group.items.push({
      label: item.label,
      naReason: item.naReason,
      openIssueNumbers: row.issues
        .filter(
          (issue) => issue.itemId === item.id && isBlockingIssue(issue.status),
        )
        .map((issue) => issue.number),
      state: item.state,
    });
  }

  return {
    checkedBy: row.checkedBy,
    checklistNumber: row.number,
    checklistTitle: row.title,
    closedAt: row.closedAt,
    comments: row.comments,
    configured: row.items.length > 0,
    final: row.status === ChecklistStatus.CLOSED,
    houseType: row.project.buildingType,
    issues: row.issues.map((issue) => {
      const item = itemsById.get(issue.itemId);
      return {
        description: issue.description,
        location: item ? `${item.section} – ${item.label}` : "",
        number: issue.number,
        statusLabel: ISSUE_STATUS_LABELS[issue.status],
        tradieName: issue.assignedTradie?.name ?? null,
        verifiedAt: issue.verifiedAt,
      };
    }),
    projectAddress: row.project.location,
    projectName: row.project.name,
    reviewerName: signer.reviewerName,
    sections,
    signatureDataUrl: signer.signatureDataUrl,
    signedAt: signer.signedAt,
    stageLabel: PROJECT_STAGE_LABELS[row.stage],
    version: row.version,
  };
}

/**
 * Render the checklist for download and record who it names, which revision
 * it printed, and whether it was final.
 *
 * Everything recorded comes from the one snapshot the document was printed
 * from. If the checklist moved while it rendered — a tick in another tab, or
 * a close — the export is refused rather than recorded against a revision it
 * does not show. The records are written only once the document rendered, and
 * together, so a failure leaves no trace of an export that never reached
 * anyone.
 */
export async function exportChecklistDocument(
  principal: DomainPrincipal,
  input: ExportChecklistInput,
  db: TransactionalDomainDb,
  render: ChecklistDocumentRenderPort,
  now: Date = new Date(),
): Promise<ExportedChecklist> {
  const reviewerName = requireReviewerName(input.reviewerName);
  const signature = requireSignature(input.signatureDataUrl);
  await authorizeProject(principal, input.projectId, db);
  const actor = await checklistActor(principal, db);
  const checklist = await loadChecklist(input, db);

  const document = await checklistDocumentData(
    input,
    { reviewerName, signatureDataUrl: signature, signedAt: now },
    db,
  );

  let pdf: Uint8Array;
  try {
    pdf = await render(document);
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw new DomainSideEffectError(
      "The checklist document could not be generated. Try again in a moment.",
      "document",
      true,
      { cause: error },
    );
  }

  const exportId = await db.$transaction(async (tx) => {
    const current = await tx.projectChecklist.findUnique({
      select: { version: true },
      where: { id: checklist.id },
    });
    if (current?.version !== document.version) {
      throw new DomainStaleVersionError(
        "The checklist changed while the document was being generated. Download it again to get the latest version.",
        document.version,
        current?.version,
      );
    }
    const signatureRow = await tx.checklistSignature.create({
      data: {
        checklistId: checklist.id,
        imageDataUrl: signature,
        purpose: ChecklistSignaturePurpose.EXPORT,
        reviewerName,
        signedAt: now,
        signedById: actor.id,
      },
      select: { id: true },
    });
    const exported = await tx.checklistExport.create({
      data: {
        checklistId: checklist.id,
        final: document.final,
        generatedAt: now,
        generatedById: actor.id,
        reviewerName,
        signatureId: signatureRow.id,
        statusAtExport: document.final
          ? ChecklistStatus.CLOSED
          : ChecklistStatus.OPEN,
        version: document.version,
      },
      select: { id: true },
    });
    return exported.id;
  });

  const name = fileSafe(`${document.projectName} ${document.checklistTitle}`);
  return {
    exportId,
    filename: `${name || "Checklist"}${document.final ? "" : "-DRAFT"}.pdf`,
    final: document.final,
    pdf,
  };
}
