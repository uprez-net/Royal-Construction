'use server';

import { generateText, NoObjectGeneratedError, TypeValidationError, Output } from "ai";
import { gateway } from "@/lib/model";
import { processPDFWithMistral } from "@/lib/ocr";
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

    const { output } = await generateText({
      model: gateway(MODEL_NAME),
      temperature: 0.15,
      system: PROJECT_EXTRACTION_SYSTEM_PROMPT,
      output: Output.object({
        schema: projectExtractionSchema,
      }),
      prompt: buildProjectExtractionPrompt({
        documents,
        tenderSummary: `${JSON.stringify(tenderPages, null, 2)}`,
        contractSummary: `${JSON.stringify(contractPages, null, 2)}`,
      }),
    });

    return validateProjectExtractionDraft(output);
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
