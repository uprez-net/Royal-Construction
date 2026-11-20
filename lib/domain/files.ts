import {
  type ComplianceDocumentType,
  type File as PrismaFile,
  Role,
} from "@prisma/client";

import type { DomainDb } from "./db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainValidationError,
} from "./errors";
import {
  authorizeFileAttachment,
  canSeeProjectFinancials,
} from "./access/projects";
import { authorizeLead } from "./access/leads";
import { canWorkComplianceFile } from "./access/compliance";
import {
  isBuildDocumentType,
  officeOnlyFileMatcher,
} from "./projects/financial-redaction";
import {
  isInternalPrincipal,
  isOfficePrincipal,
  isUserPrincipal,
  requireUserPrincipal,
  type DomainPrincipal,
} from "./principal";
import type { BlobDeletePort } from "./ports/blob";
import type { BlobUploadHeadPort } from "./ports/blob";
import { buildBlobPath } from "@/utils/formatters";
import { normalizeFileUploadHints } from "./file-tags";

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
  /** Upload hints from the screen it came from. Normalised here. */
  readonly tags?: readonly unknown[] | null;
  readonly origin?: string | null;
};

/** The part of a File row that decides who may open it. */
export type ReadableFile = {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
  readonly tags: readonly string[] | null;
  readonly uploadedBy: string;
  readonly leadId: number | null;
  readonly complianceDocument: {
    readonly documentType: ComplianceDocumentType;
    /**
     * A file received by email is filed on the compliance file with no
     * `projectId` of its own; its project is the engagement's.
     */
    readonly engagement: { readonly project: ReadableProject } | null;
  } | null;
  readonly project: ReadableProject | null;
};

type ReadableProject = {
  readonly siteManagerId: string | null;
  readonly customerId: string;
  readonly Lead: { readonly assignedId: string | null } | null;
  /** For the HBCF and tender/contract links (`officeOnlyFileMatcher`). */
  readonly requirements: unknown;
};

/**
 * May this caller open this stored file?
 *
 * Three kinds of file, three owners. A lead's file is the office's, as the
 * lead is (`isOfficePrincipal`), even one now linked to a project: the project
 * detail hides those from a site manager too (`files` in
 * `hideDetailProjectFinancials`). A compliance file follows
 * `canWorkComplianceFile`, with one exception the owner set on 2026-11-20: the
 * build documents (plans, survey, approvals) stay with the site manager of
 * that project. Any other project file is open to whoever uploaded it and to
 * the project's site manager.
 */
export function canReadFile(
  principal: DomainPrincipal,
  file: ReadableFile,
): boolean {
  if (principal.kind === "system") return true;
  if (!isUserPrincipal(principal)) return false;
  if (file.leadId !== null) return isOfficePrincipal(principal);
  if (principal.role === Role.ADMIN) return true;
  // A file received by email onto the compliance file has no projectId of its
  // own; its project is the engagement's.
  const project =
    file.project ?? file.complianceDocument?.engagement?.project ?? null;
  // The HBCF certificate and claims, and the tender and contract, are the
  // office's however and wherever they were filed — the compliance file
  // included: the project detail hides them from anyone who cannot see the
  // money (`hideDetailProjectFinancials`), so the download does too. Checked
  // before the compliance rule, which would otherwise admit them.
  if (
    !canSeeProjectFinancials(principal)
    && officeOnlyFileMatcher(project?.requirements)({
      id: file.id,
      name: file.filename,
      tags: file.tags,
      url: file.url,
    })
  ) {
    return false;
  }
  if (file.complianceDocument !== null) {
    if (
      project !== null
      && canWorkComplianceFile(principal, {
        customerId: project.customerId,
        leadAssignedId: project.Lead?.assignedId ?? null,
        siteManagerId: project.siteManagerId,
      })
    ) {
      return true;
    }
    return (
      principal.role === Role.SITE_MANAGER
      && project?.siteManagerId === principal.userId
      && isBuildDocumentType(file.complianceDocument.documentType)
    );
  }
  return (
    file.uploadedBy === principal.userId
    || file.project?.siteManagerId === principal.userId
  );
}

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

  // The browser normalised these too, but its copy is not the one to trust.
  const hints = normalizeFileUploadHints(input);
  const data = {
    filename: input.fileName,
    fileType: input.fileType,
    filesize: input.fileSize,
    id: input.fileId,
    incidentId: null,
    leadId: input.leadId ? Number(input.leadId) : null,
    milestoneId: input.milestoneId ?? null,
    origin: hints.origin,
    projectId,
    storagePath: input.storagePath,
    tags: [...hints.tags],
    uploadedBy: input.userId,
    url: input.fileUrl,
  };

  // The browser confirmation and Blob callback can arrive in either order.
  // Replaying the same upload must never replace an existing file's scope.
  const sameUpload = (file: PrismaFile): PrismaFile => {
    if (
      file.uploadedBy !== input.userId
      || file.projectId !== projectId
      || file.leadId !== data.leadId
      || file.milestoneId !== data.milestoneId
      || file.url !== input.fileUrl
    ) {
      throw new DomainAuthorizationError(
        "That file ID belongs to a different upload.",
      );
    }
    return file;
  };
  if (input.fileId) {
    const existing = await db.file.findUnique({ where: { id: input.fileId } });
    if (existing) return sameUpload(existing);
  }
  try {
    return await db.file.create({ data });
  } catch (error) {
    if (
      input.fileId
      && typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "P2002"
    ) {
      const existing = await db.file.findUnique({
        where: { id: input.fileId },
      });
      if (existing) return sameUpload(existing);
    }
    throw error;
  }
}

/** Confirm storage and persist metadata before a screen uses the file ID. */
export async function completeProjectFileUpload(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly milestoneId?: string | null;
    readonly fileId: string;
    readonly fileName: string;
    readonly fileUrl: string;
    readonly tags?: readonly unknown[] | null;
    readonly origin?: string | null;
  },
  db: DomainDb,
  inspectBlob: BlobUploadHeadPort,
): Promise<PrismaFile> {
  const user = requireUserPrincipal(principal);
  await authorizeFileAttachment(user, input, db);
  let blob: Awaited<ReturnType<BlobUploadHeadPort>>;
  try {
    blob = await inspectBlob(input.fileUrl);
  } catch {
    throw new DomainSideEffectError(
      "Unable to confirm the uploaded file. Please try again.",
      "blob",
      true,
    );
  }
  const expectedPath = buildBlobPath({
    ...input,
    milestoneId: input.milestoneId ?? undefined,
  });
  // Blob inserts its random suffix before the last extension. Match the full
  // canonical path, never just a project prefix supplied by the browser.
  const dot = expectedPath.lastIndexOf(".");
  const extensionStart =
    dot > expectedPath.lastIndexOf("/") ? dot : expectedPath.length;
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^${escape(expectedPath.slice(0, extensionStart))}(?:-[a-zA-Z0-9]+)?${escape(expectedPath.slice(extensionStart))}$`,
  );
  if (blob.url !== input.fileUrl || !pattern.test(blob.pathname)) {
    throw new DomainNotFoundError(
      "That uploaded file does not belong to this project.",
    );
  }
  return saveFile(
    principal,
    {
      ...input,
      userId: user.userId,
      milestoneId: input.milestoneId ?? undefined,
      fileType: blob.contentType,
      fileSize: blob.size,
      storagePath: blob.pathname,
    },
    db,
  );
}
