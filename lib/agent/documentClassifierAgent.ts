import { ComplianceDocumentType } from "@prisma/client";
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
} from "ai";
import { z } from "zod";

import { CLASSIFIABLE_DOCUMENT_TYPES } from "@/constants/complianceDocuments";
import { gateway } from "@/lib/model";
import { ocrPagesToText, processPDFWithMistral } from "@/lib/ocr";
import {
  buildDocumentClassifierPrompt,
  DOCUMENT_CLASSIFIER_SYSTEM_PROMPT,
} from "./document-classifier-prompts";

/**
 * Single-field output, defaulting to UNKNOWN.
 *
 * Blank-tolerant on purpose: "I could not tell" is a correct answer here, and
 * the schema has to be able to express it or the model is forced to pick a
 * wrong label instead. A wrongly-labelled compliance document routes itself
 * into the wrong slot silently; an unlabelled one is visibly incomplete.
 */
export const documentClassificationSchema = z.object({
  documentType: z
    .enum(CLASSIFIABLE_DOCUMENT_TYPES)
    .default(ComplianceDocumentType.UNKNOWN)
    .describe(
      "Which kind of compliance document this is. Return UNKNOWN whenever the document does not clearly and positively match one of the listed types — never guess between two plausible candidates.",
    ),
});

export type DocumentClassification = z.infer<
  typeof documentClassificationSchema
>;

export type DocumentClassifierInput = {
  markdown: string;
  fileName?: string;
};

export type DocumentClassifierResult = {
  documentType: ComplianceDocumentType;
  message: string;
  ok: boolean;
};

// Matches the budget lib/workflow/project.ts and lib/graph/lead-attachments.ts
// give the same OCR endpoint. processPDFWithMistral has no timeout of its own,
// so without this one slow scan can take the whole invocation with it.
const OCR_TIMEOUT_MS = 75_000;

// A classification only needs enough of the document to recognise it, and the
// title block is on the first page. Sending a 200-page drawing set in full
// costs the whole context window to answer a question the first two pages
// already answered.
const MAX_MARKDOWN_CHARS = 40_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)}s.`),
      );
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

/**
 * Identifies which compliance document a piece of OCR markdown is.
 *
 * Never throws for a model-side failure: a document the model cannot parse
 * degrades to UNKNOWN with `ok: false`, so the file stays stored and linked and
 * a person can label it by hand. Anything else — a gateway outage, a bad API
 * key — is rethrown, because that is a real failure the caller's retry should
 * see rather than a document that happens to be unreadable.
 *
 * @param input - OCR markdown for the document, plus its name for reporting.
 * @returns The identified type (possibly UNKNOWN) and whether the model
 * answered at all.
 */
export async function classifyDocumentMarkdown(
  input: DocumentClassifierInput,
): Promise<DocumentClassifierResult> {
  const markdown = input.markdown.trim();

  if (!markdown) {
    return {
      documentType: ComplianceDocumentType.UNKNOWN,
      message: "The document produced no readable text.",
      ok: false,
    };
  }

  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      temperature: 0.015,
      topK: 30,
      system: DOCUMENT_CLASSIFIER_SYSTEM_PROMPT,
      output: Output.object({ schema: documentClassificationSchema }),
      prompt: buildDocumentClassifierPrompt(
        markdown.slice(0, MAX_MARKDOWN_CHARS),
        input.fileName,
      ),
    });

    const parsed = documentClassificationSchema.parse(output);

    return {
      documentType: parsed.documentType,
      message:
        parsed.documentType === ComplianceDocumentType.UNKNOWN
          ? "The document could not be identified with confidence."
          : `Identified as ${parsed.documentType}.`,
      ok: true,
    };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error) ||
      TypeValidationError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    ) {
      return {
        documentType: ComplianceDocumentType.UNKNOWN,
        message: `Classification was incomplete: ${error.message}`,
        ok: false,
      };
    }

    throw error;
  }
}

/**
 * Classifies a document from its public blob url, OCR included.
 *
 * The convenience path for callers that have a stored file rather than
 * markdown. OCR failure degrades to UNKNOWN in the same way a model failure
 * does — an unreadable scan is a document nobody can label automatically, not
 * an error worth failing a workflow step over.
 *
 * @param url - Public url Mistral can fetch.
 * @param fileName - The file's name, for reporting only.
 */
export async function classifyDocumentAtUrl(
  url: string,
  fileName?: string,
): Promise<DocumentClassifierResult> {
  let markdown: string;
  try {
    const pages = await withTimeout(
      processPDFWithMistral(url),
      OCR_TIMEOUT_MS,
      `OCR of ${fileName ?? url}`,
    );
    markdown = ocrPagesToText(pages);
  } catch (error) {
    console.error(`  OCR failed for "${fileName ?? url}":`, error);
    return {
      documentType: ComplianceDocumentType.UNKNOWN,
      message: "The document could not be read.",
      ok: false,
    };
  }

  return classifyDocumentMarkdown({ markdown, fileName });
}
