import type { ProjectExtractionSectionKey } from "@/types/project-extraction";

type TenderExtractionPromptInput = {
  tenderMarkdown: string;
  contractMarkdown: string;
  tenderFileName: string;
  contractFileName: string;
};

const ISSUE_56_MAPPING = `
Issue #56 extraction contract:
- Fill each schema field individually from the most specific source section available.
- Leave a field blank ("" / null / []) when the value is not explicitly present.
- Never fabricate, infer, or complete missing data from context.
- Never emit raw JSON, nested objects, or object-like strings for a field value.
- Prefer Tender for scope, inclusions, exclusions, pricing, and acceptance language.
- Prefer Contract for signed-date, MBA reference, payment timing, and any post-sign legal metadata.
- If the documents conflict, keep the most document-specific value and leave a short conflict note in the source reasoning, not in the field value.
`;

const SECTION_GUIDE: Record<ProjectExtractionSectionKey, string> = {
  projectOverview: "Project name, type, summary, and the high-level site metadata that appears in the header or cover pages.",
  legalAdministration: "Client/site identity, owner contact details, commencement trigger, signature date, and PCA/inspector references.",
  commercialsAndClaims: "Contract sum, GST, deposit, payment stages, claim percentages, and any commercial arithmetic shown on the Tender or Contract.",
  subStructureAndGround: "Slab, footings, termite, vapour barrier, sewer and other substructure references.",
  shellAndExternal: "Roof, brick, window, facade, floor area, and envelope-level construction notes.",
  mechanicalDetails: "Electrical and mechanical scope, lighting, power points, AC, and sealant-related details.",
  internalFitOutAndFinishes: "Doors, skirting, stone, tiles, bathroom allowance, and other interior finish scope.",
  exclusionsAndRisks: "Explicit exclusions, owner-responsibility items, variations, rock excavation, fencing, blinds, and similar risk items.",
  utilityInfrastructure: "Utility connections and service infrastructure references.",
  wetAreaCompliance: "Waterproofing, wet area, shower, niche, waste, and tile compliance details.",
  safetyAndSiteLogistics: "Safety, access, scaffold, sediment, trade waste, and final clean responsibilities.",
};

export const TENDER_EXTRACTION_SYSTEM_PROMPT = `
You are a construction document extraction specialist for Royal Constructions.

Your job is to read a Tender PDF and a signed Contract PDF and populate a flat extraction object that matches the provided schema exactly.

${ISSUE_56_MAPPING}

Rules:
- Return only structured output that matches the schema.
- Treat every field as independent. Do not bundle values into paragraphs, tables, arrays of objects, or nested JSON.
- Use empty string, null, or [] for any value that cannot be verified directly from the documents.
- Do not guess. Do not tidy. Do not improve the source text.
- Use Tender sections for scope, inclusions, exclusions, allowances, payment schedule, and acceptance language.
- Use Contract sections for signature date, contract administration metadata, and any MBA-specific reference information.
- If a field appears in both documents, prefer the signed Contract for post-signature administrative facts and the Tender for scope/legal package content.
- If a field is not found, leave it blank rather than fabricating something plausible.

Section guide:
${Object.entries(SECTION_GUIDE)
  .map(([key, description]) => `- ${key}: ${description}`)
  .join("\n")}

Anti-hallucination reminder:
- blank means blank
- null means unknown numeric or boolean-like value
- [] means no line items were found
- never stringify a JSON object into a field
`;

export function buildTenderExtractionPrompt(input: TenderExtractionPromptInput) {
  return `
Extract the project information from the following source documents.

Tender file: ${input.tenderFileName}
Contract file: ${input.contractFileName}

Tender OCR markdown:
${input.tenderMarkdown}

Contract OCR markdown:
${input.contractMarkdown}

Populate every field you can verify. Leave the rest blank.
`;
}
