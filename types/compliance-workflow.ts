/**
 * The checklist workflow's wire contract.
 *
 * Split out from `lib/workflow/compliance-checklist.ts` because both sides of
 * the stream need it and only one side can have the workflow module. That file
 * imports prisma and the OCR client; importing a *value* from it into a client
 * component — the stage list, the workflow tag — drags the whole server module
 * into the browser bundle and the build fails resolving `pg`. Types alone would
 * be erased and fine, but these are runtime values.
 *
 * Nothing here may import anything server-side. That is the entire point.
 */

/**
 * The stages the client shows, in order.
 *
 * One list, imported by both the workflow that emits them and the modal that
 * renders them. `create-project-modal.tsx` keeps a second copy of the tender
 * stage list, and when those drift `indexOf(stage)` returns -1 and the progress
 * bar silently stops moving — a bug with no error attached to it.
 */
export const CHECKLIST_EXTRACTION_PROGRESS = [
  "Reading checklist",
  "Extracting items",
  "Saving checklist",
] as const;

export type ChecklistStage = (typeof CHECKLIST_EXTRACTION_PROGRESS)[number];

export type ChecklistItem = {
  label: string;
  order: number;
};

export type ChecklistExtractionResult = {
  status: "success" | "error";
  items: ChecklistItem[];
  message: string;
  error?: string;
};

/**
 * Tags every event on the wire.
 *
 * One resume-stream route serves every workflow, and the tender extraction
 * events already use `type: "stage" | "result" | "error"`. Without a second
 * discriminant the client cannot tell a checklist stage from a tender stage,
 * and a run of either would drive both progress bars.
 */
export const COMPLIANCE_CHECKLIST_WORKFLOW = "compliance-checklist" as const;

export type ComplianceChecklistStreamEvent = {
  workflow: typeof COMPLIANCE_CHECKLIST_WORKFLOW;
} & (
  | { type: "stage"; stage: ChecklistStage; index: number; total: number }
  | { type: "result"; result: ChecklistExtractionResult }
  | { type: "error"; message: string }
);

export type ChecklistExtractionInput = {
  projectId: string;
  engagementId: string;
  documentId: string;
};
