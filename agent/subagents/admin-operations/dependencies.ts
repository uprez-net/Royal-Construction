import { listAuthorizedTeam, resolveAuthorizedApproval } from "@/agent/lib/admin-operations";

export type AdminOperations = {
  listAuthorizedTeam: typeof listAuthorizedTeam;
  resolveAuthorizedApproval: typeof resolveAuthorizedApproval;
};

export function createAdminOperations(overrides: Partial<AdminOperations> = {}): AdminOperations {
  return { listAuthorizedTeam, resolveAuthorizedApproval, ...overrides };
}
