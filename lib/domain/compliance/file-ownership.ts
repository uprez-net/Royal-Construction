import { ComplianceDocumentType } from "@prisma/client";

import { assertCanFileComplianceDocument } from "../access/projects";
import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainNotFoundError } from "../errors";
import { projectHbcfFileIds } from "../insurance/hbcf-claims";
import type { DomainPrincipal } from "../principal";

/**
 * The file a compliance upload names, provided it is this project's.
 *
 * A file is the project's when it was uploaded to the project (`projectId`),
 * or when it arrived on this project's compliance file — an attachment off a
 * certifier's or consultant's email is created with no `projectId`, only the
 * compliance document it landed on, and placing it is the same act as an
 * upload.
 *
 * Read before anything is written. The attach used to look the id up and point
 * it at the document whatever project it came from, so an id from another job
 * would have moved that job's file onto this one's compliance file.
 */
export async function requireProjectComplianceFile(
  input: { readonly projectId: string; readonly fileId: string },
  db: DomainDb,
) {
  const file = await db.file.findFirst({
    where: {
      id: input.fileId,
      OR: [
        { projectId: input.projectId },
        { complianceDocument: { engagement: { projectId: input.projectId } } },
      ],
    },
    select: { id: true, filename: true, url: true },
  });
  if (file) return file;

  const elsewhere = await db.file.findUnique({
    where: { id: input.fileId },
    select: { id: true },
  });
  if (elsewhere) {
    throw new DomainAuthorizationError("That file belongs to another project.");
  }
  throw new DomainNotFoundError(`File ${input.fileId} not found.`);
}

/**
 * Delete the files a compliance document held before `keepFileId` replaced
 * them, and return them so the caller can reclaim their blobs.
 *
 * Every upload control on the compliance tab is a single-file "Replace": one
 * row holds one document. A replaced file is deleted, so it answers to the
 * same rule as the one moving in (`assertCanMoveComplianceFile`): a file the
 * project's HBCF record points at stays unless the caller may file HBCF. Every
 * file is checked before any is deleted, so a refusal deletes nothing. Run it
 * inside the caller's transaction, so the row is never left pointing at two
 * files and a refusal rolls the whole attach back.
 */
export async function deleteSupersededComplianceFiles(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly documentId: string;
    readonly keepFileId: string;
  },
  tx: DomainDb,
): Promise<{ id: string; url: string }[]> {
  const superseded = await tx.file.findMany({
    where: {
      complianceDocumentId: input.documentId,
      id: { not: input.keepFileId },
    },
    select: { id: true, url: true },
  });

  for (const stale of superseded) {
    await assertCanMoveComplianceFile(
      principal,
      { projectId: input.projectId, fileId: stale.id },
      tx,
    );
  }

  if (superseded.length > 0) {
    await tx.file.deleteMany({
      where: { id: { in: superseded.map((stale) => stale.id) } },
    });
  }
  return superseded;
}

/**
 * Refuses to move a file that is part of the project's HBCF record — the
 * certificate on the compliance file, or a certificate or claim document the
 * Overview holds — for anyone who may not file HBCF. Attaching moves the file
 * off its row, and a later replacement deletes it, which would leave the
 * project pointing at a certificate that is gone.
 */
export async function assertCanMoveComplianceFile(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly fileId: string },
  db: DomainDb,
): Promise<void> {
  const [file, project] = await Promise.all([
    db.file.findUnique({
      where: { id: input.fileId },
      select: { complianceDocument: { select: { documentType: true } } },
    }),
    db.project.findUnique({
      where: { id: input.projectId },
      select: { requirements: true },
    }),
  ]);
  const legal = (
    project?.requirements as { legalAdministration?: unknown } | null
  )?.legalAdministration as Parameters<typeof projectHbcfFileIds>[0];
  if (
    file?.complianceDocument?.documentType
      === ComplianceDocumentType.HOME_INSURANCE
    || projectHbcfFileIds(legal).has(input.fileId)
  ) {
    assertCanFileComplianceDocument(
      principal,
      ComplianceDocumentType.HOME_INSURANCE,
    );
  }
}
