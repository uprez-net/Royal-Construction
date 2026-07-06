'use server';

import { generateObject, NoObjectGeneratedError, TypeValidationError } from "ai";
import { gateway } from "@/lib/model";
import { processPDFWithMistral } from "@/lib/ocr";
import { summarizeOcrPagesForOffer } from "@/lib/tools/offer-context";
import { buildProjectExtractionPrompt, PROJECT_EXTRACTION_SYSTEM_PROMPT } from "./projectExtraction-prompts";
import { projectExtractionSchema, validateProjectExtractionDraft } from "./projectExtraction-validators";
import type { ProjectDocumentBundle, ProjectExtractionDraft } from "@/types/project-flow";

const MODEL_NAME = "google/gemini-2.5-flash" as const;

export type ProjectDocumentExtractionInput = {
  documents: ProjectDocumentBundle;
};

export async function extractProjectDocuments({ documents }: ProjectDocumentExtractionInput): Promise<ProjectExtractionDraft> {
  try {
    const [tenderPages, contractPages] = await Promise.all([
      processPDFWithMistral(documents.tender.url),
      processPDFWithMistral(documents.contract.url),
    ]);

    const tenderSummary = JSON.stringify(
      summarizeOcrPagesForOffer(tenderPages, {
        fileUrl: documents.tender.url,
        fileName: documents.tender.fileName,
      }),
      null,
      2,
    );
    const contractSummary = JSON.stringify(
      summarizeOcrPagesForOffer(contractPages, {
        fileUrl: documents.contract.url,
        fileName: documents.contract.fileName,
      }),
      null,
      2,
    );

    const { object } = await generateObject({
      model: gateway(MODEL_NAME),
      temperature: 0.15,
      system: PROJECT_EXTRACTION_SYSTEM_PROMPT,
      schema: projectExtractionSchema,
      prompt: buildProjectExtractionPrompt({
        documents,
        tenderSummary,
        contractSummary,
      }),
    });

    return validateProjectExtractionDraft(object);
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      throw new Error("The extraction agent did not return structured project data.");
    }

    if (TypeValidationError.isInstance(error)) {
      throw new Error(`The extraction agent returned invalid project data. ${error.message}`);
    }

    throw error;
  }
}
