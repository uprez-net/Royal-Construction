'use server';

import { generateText, NoObjectGeneratedError, TypeValidationError, Output } from "ai";
import { gateway } from "@/lib/model";
import { processPDFWithMistral } from "@/lib/ocr";
import { buildProjectExtractionPrompt, PROJECT_EXTRACTION_SYSTEM_PROMPT } from "./projectExtraction-prompts";
import { projectExtractionSchema, validateProjectExtractionDraft } from "./projectExtraction-validators";
import type { ProjectDocumentBundle, ProjectExtractionDraft } from "@/types/project-flow";

const MODEL_NAME = "google/gemini-2.5-flash" as const;
const OCR_TIMEOUT_MS = 45_000;
const MODEL_TIMEOUT_MS = 45_000;
const OCR_SUMMARY_CHAR_LIMIT = 18_000;

export type ProjectDocumentExtractionInput = {
  documents: ProjectDocumentBundle;
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function buildOcrSummary(pages: unknown, label: string) {
  const normalized = Array.isArray(pages)
    ? pages.map((page, index) => {
        if (page && typeof page === "object") {
          const record = page as Record<string, unknown>;
          return {
            pageNumber:
              typeof record.index === "number"
                ? record.index + 1
                : index + 1,
            markdown:
              typeof record.markdown === "string"
                ? record.markdown
                : typeof record.text === "string"
                  ? record.text
                  : "",
            imageCaption:
              typeof record.imageCaption === "string"
                ? record.imageCaption
                : undefined,
          };
        }

        return {
          pageNumber: index + 1,
          markdown: String(page ?? ""),
        };
      })
    : [{ pageNumber: 1, markdown: String(pages ?? "") }];

  const serialized = JSON.stringify(normalized, null, 2);
  if (serialized.length <= OCR_SUMMARY_CHAR_LIMIT) {
    return serialized;
  }

  return `${serialized.slice(0, OCR_SUMMARY_CHAR_LIMIT)}\n... [${label} OCR truncated to ${OCR_SUMMARY_CHAR_LIMIT} chars]`;
}

export async function extractProjectDocuments({ documents }: ProjectDocumentExtractionInput): Promise<ProjectExtractionDraft> {
  try {
    const [tenderPages, contractPages] = await withTimeout(
      Promise.all([
        processPDFWithMistral(documents.tender.url),
        processPDFWithMistral(documents.contract.url),
      ]),
      OCR_TIMEOUT_MS,
      "Project document OCR",
    );

    const { output } = await withTimeout(
      generateText({
        model: gateway(MODEL_NAME),
        temperature: 0.15,
        system: PROJECT_EXTRACTION_SYSTEM_PROMPT,
        output: Output.object({
          schema: projectExtractionSchema,
        }),
        prompt: buildProjectExtractionPrompt({
          documents,
          tenderSummary: buildOcrSummary(tenderPages, "Tender"),
          contractSummary: buildOcrSummary(contractPages, "Contract"),
        }),
      }),
      MODEL_TIMEOUT_MS,
      "Project extraction model",
    );

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
