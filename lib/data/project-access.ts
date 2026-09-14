import "server-only";

import prisma from "@/lib/prisma";
import {
  canAttachToProject,
  type ProjectUploader,
} from "@/lib/projects/project-access";

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
 * Both ids arrive from outside (an upload's client payload, an MCP tool call),
 * so a milestone is resolved to the project it actually belongs to rather than
 * trusted to belong to the project named alongside it.
 */
export async function assertCanAttachToProject(
  user: ProjectUploader,
  target: { projectId?: string | null; milestoneId?: string | null },
): Promise<{ projectId: string }> {
  let projectId = target.projectId?.trim() || null;
  const milestoneId = target.milestoneId?.trim() || null;

  if (milestoneId) {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { projectId: true },
    });
    if (!milestone || (projectId && milestone.projectId !== projectId)) {
      throw new ProjectAccessError("Milestone not found", 404);
    }
    projectId = milestone.projectId;
  }

  if (!projectId) {
    throw new ProjectAccessError("Project not found", 404);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { customerId: true },
  });
  if (!project) {
    throw new ProjectAccessError("Project not found", 404);
  }
  if (!canAttachToProject(user, project)) {
    throw new ProjectAccessError("You do not have access to this project", 403);
  }

  return { projectId };
}
