import type { File as PrismaFile, Role } from "@prisma/client";

import type { DomainDb } from "./db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "./errors";
import { authorizeFileAttachment } from "./access/projects";
import { authorizeLead } from "./access/leads";
import {
  isInternalPrincipal,
  isUserPrincipal,
  type DomainPrincipal,
} from "./principal";
import type { BlobDeletePort } from "./ports/blob";

export type SaveFileInput = {
  readonly userId: string;
  readonly projectId?: string;
  readonly milestoneId?: string;
  readonly leadId?: string;
  readonly fileId?: string;
  readonly fileUrl: string;
  readonly storagePath?: string;
  readonly fileName: string;
  readonly fileType: string;
  readonly fileSize: number;
};

/**
 * Decide whether one Blob URL is this lead's to delete.
 *
 * Kept separate from the command below because the rule is worth asserting on
 * its own, and because a caller that only needs the answer — a check before
 * offering a delete button — should not have to hand over the capability to
 * perform it.
 */
export async function authorizeLeadFileDeletion(
  principal: DomainPrincipal,
  input: { blobUrl: string; leadId: string | number },
  db: DomainDb,
): Promise<{ blobUrl: string; leadId: number }> {
  const leadId =
    typeof input.leadId === "number" ? input.leadId : Number(input.leadId);
  if (!Number.isInteger(leadId)) {
    throw new DomainValidationError("Invalid lead ID.", "leadId");
  }
  await authorizeLead(principal, leadId, db);

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(input.blobUrl).pathname);
  } catch {
    throw new DomainValidationError("The Blob URL is invalid.", "blobUrl");
  }
  if (!pathname.includes(`/leads/${leadId}/`)) {
    throw new DomainAuthorizationError("Blob does not belong to this lead.");
  }
  return { blobUrl: input.blobUrl, leadId };
}

/**
 * Authorize and perform the deletion as one command.
 *
 * The adapter used to receive an authorized URL and call `del` on it itself,
 * which is the same rule and the same effect written in two files. Nothing but
 * the adapter's own care joined them: a caller that ignored the answer deleted
 * an unauthorized object, and no test of the rule could see it.
 */
export async function deleteLeadFile(
  principal: DomainPrincipal,
  input: { blobUrl: string; leadId: string | number },
  db: DomainDb,
  deleteBlob: BlobDeletePort,
): Promise<{ blobUrl: string; leadId: number }> {
  const authorized = await authorizeLeadFileDeletion(principal, input, db);
  await deleteBlob(authorized.blobUrl);
  return authorized;
}

/**
 * Persist one uploaded file after re-checking the target against the caller.
 *
 * Blob token generation and cleanup stay in the route adapters. This command
 * owns the durable File row and refuses a forged uploader id, a customer
 * attaching to another lead/project, or a milestone from another project.
 */
export async function saveFile(
  principal: DomainPrincipal,
  input: SaveFileInput,
  db: DomainDb,
): Promise<PrismaFile> {
  if (isUserPrincipal(principal) && input.userId !== principal.userId) {
    throw new DomainAuthorizationError(
      "The uploaded file must belong to the signed-in user.",
    );
  }
  if (!isInternalPrincipal(principal) && !isUserPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "File uploads require a signed-in user.",
    );
  }
  if (input.fileSize < 0 || !Number.isFinite(input.fileSize)) {
    throw new DomainValidationError("File size is invalid.", "fileSize");
  }
  if (input.leadId && (input.projectId || input.milestoneId)) {
    throw new DomainValidationError(
      "A file may target a lead or a project, not both.",
      "leadId",
    );
  }

  const uploader = await db.user.findUnique({
    select: { customerId: true, id: true, role: true },
    where: { id: input.userId },
  });
  if (!uploader) throw new DomainNotFoundError("Uploading user not found");

  let projectId = input.projectId ?? null;
  if (input.projectId || input.milestoneId) {
    ({ projectId } = await authorizeFileAttachment(
      {
        customerId: uploader.customerId,
        role: uploader.role as Role,
      },
      { milestoneId: input.milestoneId, projectId: input.projectId },
      db,
    ));
  }
  if (input.leadId) {
    const leadId = Number(input.leadId);
    if (!Number.isInteger(leadId)) {
      throw new DomainValidationError("Lead id is invalid.", "leadId");
    }
    await authorizeLead(principal, leadId, db);
  }

  return db.file.create({
    data: {
      filename: input.fileName,
      fileType: input.fileType,
      filesize: input.fileSize,
      id: input.fileId,
      incidentId: null,
      leadId: input.leadId ? Number(input.leadId) : null,
      milestoneId: input.milestoneId ?? null,
      projectId,
      storagePath: input.storagePath,
      uploadedBy: input.userId,
      url: input.fileUrl,
    },
  });
}
