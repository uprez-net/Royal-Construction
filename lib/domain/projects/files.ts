import { authorizeProject } from "../access/projects";
import { logActionOrThrow } from "../audit/action-log";
import { reclaimSupersededComplianceFiles } from "../compliance/file-reclamation";
import type { TransactionalDomainDb } from "../db";
import { DomainNotFoundError, DomainValidationError } from "../errors";
import type { BlobDeletePort } from "../ports/blob";
import {
  requireAdminPrincipal,
  requireUserPrincipal,
  type DomainPrincipal,
} from "../principal";

/** Remove a project document, preserving copies used by other records. */
export async function deleteProjectFile(
  principal: DomainPrincipal,
  input: { projectId: string; fileId: string },
  db: TransactionalDomainDb,
  deleteBlob: BlobDeletePort,
) {
  requireAdminPrincipal(principal);
  const actor = requireUserPrincipal(principal);
  const removed = await db.$transaction(async (tx) => {
    await authorizeProject(principal, input.projectId, tx);
    const file = await tx.file.findFirst({
      where: { id: input.fileId, projectId: input.projectId },
    });
    if (!file)
      throw new DomainNotFoundError(
        "That file does not belong to this project.",
      );
    if (file.complianceDocumentId || file.incidentId) {
      throw new DomainValidationError(
        "This file is used by a compliance document or incident report. Manage it from that record.",
        "fileId",
      );
    }
    const updates = await tx.siteUpdate.findMany({
      where: { projectId: input.projectId, photoUrls: { has: file.url } },
      select: { id: true, photoUrls: true },
    });
    for (const update of updates) {
      await tx.siteUpdate.update({
        where: { id: update.id },
        data: { photoUrls: update.photoUrls.filter((url) => url !== file.url) },
      });
    }
    // Project creation also links the lead's original documents to the project.
    // Removing that copy must not erase the lead's conversation attachments.
    if (file.leadId !== null) {
      await tx.file.update({
        where: { id: file.id },
        data: { projectId: null, milestoneId: null },
      });
    } else {
      await tx.file.delete({ where: { id: file.id } });
    }
    await logActionOrThrow(
      {
        authorId: actor.userId,
        message: `Document deleted: ${file.filename}`,
        milestoneId: file.milestoneId,
        projectId: input.projectId,
        timestamp: new Date(),
        type: "file-deleted",
      },
      tx,
    );
    return file;
  });

  let storageCleanupFailed = false;
  // Uploaded project files have their own path. Offer/lead documents can point
  // at an executed contract used outside this table and must retain storage.
  try {
    const path = removed.storagePath ?? new URL(removed.url).pathname.slice(1);
    if (
      removed.leadId === null
      && path.startsWith(`projects/${input.projectId}/`)
    ) {
      const engagement = await db.certifierEngagement.findUnique({
        where: { projectId: input.projectId },
        select: { id: true },
      });
      await reclaimSupersededComplianceFiles(
        engagement?.id ?? "",
        [removed],
        db,
        deleteBlob,
      );
    }
  } catch (error) {
    // The durable removal succeeded. Report cleanup separately so retrying
    // does not pretend that a missing row is a failed document deletion.
    console.error("[files] Project document storage cleanup failed", error);
    storageCleanupFailed = true;
  }
  return {
    projectId: input.projectId,
    fileId: removed.id,
    url: removed.url,
    storageCleanupFailed,
  };
}
