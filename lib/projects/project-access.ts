import {
  type FileTargetProject as UploadTargetProject,
  type FileUploader as ProjectUploader,
  canAttachFileToProject,
} from "@/lib/domain/access/projects";
import { INTERNAL_ROLES } from "@/lib/domain/principal";

// Who may attach a file to a project, as one pure rule.
//
// Staff may attach to any project: every project screen offers them its upload
// controls, and the writes those uploads feed (milestone photos, project
// updates) accept any of them, so a narrower gate here only broke uploads the
// page had just offered. A customer may attach only to their own project.
//
// The rule moved to lib/domain/access/projects.ts. This module stays as the
// name the upload route and the file-writer tests already import.

export type { ProjectUploader, UploadTargetProject };

/**
 * The roles that may attach to any project.
 *
 * Derived from the domain's internal roles rather than restated: these used to
 * be two hand-kept lists with a test holding them in step, and a list that
 * cannot drift needs no test to catch it drifting.
 */
export const PROJECT_STAFF_ROLES: readonly string[] = INTERNAL_ROLES;

export function canAttachToProject(
  user: ProjectUploader,
  project: UploadTargetProject,
): boolean {
  return canAttachFileToProject(user, project);
}
