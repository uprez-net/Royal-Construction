// Who may change a project, as one pure rule.
//
// The same gate PATCH /api/projects/[projectId] and requireComplianceAccess
// (lib/compliance/access.ts) spell out inline: an admin, the project's site
// manager, whoever the lead behind it is assigned to, or the customer the
// project belongs to. Kept free of Prisma so the decision is testable.

export type ProjectEditor = {
  readonly id: string;
  readonly role: string;
  readonly customerId?: string | null;
};

export type EditableProject = {
  readonly customerId: string;
  readonly siteManagerId: string | null;
  readonly Lead: { readonly assignedId: string | null } | null;
};

export function canEditProject(
  user: ProjectEditor,
  project: EditableProject,
): boolean {
  return (
    user.role === "ADMIN" ||
    project.siteManagerId === user.id ||
    project.Lead?.assignedId === user.id ||
    (user.role === "CUSTOMER" &&
      Boolean(user.customerId) &&
      user.customerId === project.customerId)
  );
}
