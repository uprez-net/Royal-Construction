import "server-only";

import prisma from "@/lib/prisma";
import {
  type FileUploader as ProjectUploader,
  authorizeFileAttachment,
} from "@/lib/domain/access/projects";
import { DomainNotFoundError, isDomainError } from "@/lib/domain/errors";

export type { ProjectUploader };

export class ProjectAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 404 = 403,
  ) {
    super(message);
    this.name = "ProjectAccessError";
  }
}

/**
 * Assert `user` may attach a file to a project, or to one of its milestones.
 *
 * The rule is lib/domain/access/projects.ts#authorizeFileAttachment, which the
 * upload route and the MCP tool now share. This wrapper keeps the
 * ProjectAccessError shape the route handlers already map to a status.
 */
export async function assertCanAttachToProject(
  user: ProjectUploader,
  target: { projectId?: string | null; milestoneId?: string | null },
): Promise<{ projectId: string }> {
  try {
    return await authorizeFileAttachment(user, target, prisma);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    throw new ProjectAccessError(
      error.message,
      error instanceof DomainNotFoundError ? 404 : 403,
    );
  }
}
