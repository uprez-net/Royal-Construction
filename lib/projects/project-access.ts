// Who may attach a file to a project, as one pure rule.
//
// Staff may attach to any project: every project screen offers them its upload
// controls, and the writes those uploads feed (milestone photos, project
// updates) accept any of them, so a narrower gate here only broke uploads the
// page had just offered. A customer may attach only to their own project.
// Kept free of Prisma so the decision is testable.

// canAccessLead's internal roles in lib/offer/access.ts, the roles that read
// every lead. Spelled out as strings so this module does not load Prisma; a
// test holds the two lists in step.
export const PROJECT_STAFF_ROLES: readonly string[] = [
  "ADMIN",
  "SITE_MANAGER",
  "GUEST",
];

export type ProjectUploader = {
  readonly role: string;
  readonly customerId?: string | null;
};

export type UploadTargetProject = {
  readonly customerId: string;
};

export function canAttachToProject(
  user: ProjectUploader,
  project: UploadTargetProject,
): boolean {
  if (PROJECT_STAFF_ROLES.includes(user.role)) {
    return true;
  }
  return (
    user.role === "CUSTOMER" &&
    Boolean(user.customerId) &&
    user.customerId === project.customerId
  );
}
