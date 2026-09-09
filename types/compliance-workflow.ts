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
  // The last stage is short and is named anyway, because it is the one that
  // surprises people: a checklist that comes back with a third of its lines
  // already answered needs the progress bar to have said, a second earlier,
  // that it was going to look.
  "Matching what we already hold",
] as const;

export type ChecklistStage = (typeof CHECKLIST_EXTRACTION_PROGRESS)[number];

export type ChecklistItem = {
  label: string;
  order: number;
  /**
   * What the extraction read about the line beyond its name.
   *
   * Structurally duplicated from ChecklistItemDetail in types/compliance.ts
   * rather than imported, and deliberately: this module is the wire contract and
   * the note at the top of the file is the reason — the progress modal is a
   * client component, and types/compliance.ts pulls in Prisma. A type-only
   * import would erase, but the enum ChecklistItemDetail.mapsToType refers to is
   * a runtime value, so importing it here would be one refactor away from
   * dragging Prisma into the browser bundle again.
   *
   * Optional because the modal only reports what was extracted; nothing on the
   * client acts on it.
   */
  detail?: {
    clause?: string;
    group?: string;
    description?: string;
    requirements?: string[];
    references?: string[];
  } | null;
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
