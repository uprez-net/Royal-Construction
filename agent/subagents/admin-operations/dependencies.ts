import {
  listAuthorizedTeam,
  resolveAuthorizedApproval,
  getAuthorizedBuildSequence,
  updateAuthorizedBuildSequence,
  runAdminWrite,
} from "@/agent/lib/admin-operations";

export type AdminOperations = {
  listAuthorizedTeam: typeof listAuthorizedTeam;
  resolveAuthorizedApproval: typeof resolveAuthorizedApproval;
  getAuthorizedBuildSequence: typeof getAuthorizedBuildSequence;
  updateAuthorizedBuildSequence: typeof updateAuthorizedBuildSequence;
  runAdminWrite: typeof runAdminWrite;
};

export function createAdminOperations(
  overrides: Partial<AdminOperations> = {},
): AdminOperations {
  return {
    listAuthorizedTeam,
    resolveAuthorizedApproval,
    getAuthorizedBuildSequence,
    updateAuthorizedBuildSequence,
    runAdminWrite,
    ...overrides,
  };
}
