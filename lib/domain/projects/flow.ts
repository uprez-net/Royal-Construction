import type {
  ProjectDocumentBundle,
  ProjectExtractionDraft,
  ProjectRequirementsPayload,
  ProjectValidationResult,
} from "@/types/project-flow";

export function resolveProjectBudget(draft: ProjectExtractionDraft) {
  return draft.commercialsAndClaims.totalContractSum ?? 0;
}

export function buildProjectRequirementsPayload(
  draft: ProjectExtractionDraft,
  documents: ProjectDocumentBundle,
  validations: ProjectValidationResult[],
): ProjectRequirementsPayload {
  return {
    version: 1,
    sourceDocuments: documents,
    validations,
    ...draft,
  };
}
