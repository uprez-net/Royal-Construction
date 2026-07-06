import type { ProjectDocumentBundle } from "@/types/project-flow";

type ProjectExtractionPromptInput = {
  documents: ProjectDocumentBundle;
  tenderSummary: string;
  contractSummary: string;
};

export const PROJECT_EXTRACTION_SYSTEM_PROMPT = `
You are a residential construction document extraction specialist for Royal Constructions.

Extract the tender PDF and contract PDF into structured project data.

Rules:
- Return only JSON that matches the provided schema.
- Use contract values as the default resolved value when tender and contract conflict.
- If written dimensions conflict with drawn dimensions, the written dimension wins.
- Never invent values. Use null or empty strings when a field cannot be found.
- Capture both tender and contract values in the conflicts array whenever possible.
- Keep extracted data editable and normalized for downstream automation.
- Preserve enough structure for future automation triggers such as reminders, rain delays, and notice countdowns.
`;

export function buildProjectExtractionPrompt({
  documents,
  tenderSummary,
  contractSummary,
}: ProjectExtractionPromptInput) {
  return `
Extract the following project from these documents.

Tender document:
- File: ${documents.tender.fileName}
- URL: ${documents.tender.url}

Contract document:
- File: ${documents.contract.fileName}
- URL: ${documents.contract.url}

Tender OCR summary:
${tenderSummary}

Contract OCR summary:
${contractSummary}

Fill every field you can verify. Use null for unknown numeric values and empty strings for unknown text values.
Document every important discrepancy in the conflicts array.
`;
}
