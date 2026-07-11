'use server';

import { processPDFWithMistral } from "@/lib/ocr";
import { handleTenderExtractionGeneration, type TenderExtractionChunkInput } from "@/lib/agent/tenderExtractionAgent";
import { createEmptyProjectExtractionData, projectExtractionSchema, type ProjectExtractionData } from "@/types/project-extraction";

const OCR_TIMEOUT_MS = 75_000;
const MODEL_CHUNK_CHAR_LIMIT = 40_000;

export type TenderExtractionInput = {
  tenderUrl: string;
  contractUrl: string;
  tenderFileName: string;
  contractFileName: string;
};

export type TenderExtractionResult = {
  status: "success" | "partial" | "error";
  extracted: ProjectExtractionData;
  message: string;
  error?: string;
  autoFilledCount: number;
  totalFields: number;
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

function normalizePageMarkdown(page: unknown, index: number) {
  if (page && typeof page === "object") {
    const record = page as Record<string, unknown>;
    const markdown = typeof record.markdown === "string"
      ? record.markdown
      : typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";

    const pageNumber = typeof record.pageNumber === "number"
      ? record.pageNumber
      : typeof record.index === "number"
        ? record.index + 1
        : index + 1;

    return `\n\n--- PAGE ${pageNumber} ---\n\n${markdown}`;
  }

  return `\n\n--- PAGE ${index + 1} ---\n\n${String(page ?? "")}`;
}

function pageBlocksToMarkdown(pages: unknown) {
  const pageArray = Array.isArray(pages) ? pages : pages ? [pages] : [];
  return pageArray.map((page, index) => normalizePageMarkdown(page, index)).join("\n");
}

function chunkMarkdown(markdown: string, maxChars: number) {
  if (markdown.length <= maxChars) {
    return [markdown];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < markdown.length) {
    let end = Math.min(start + maxChars, markdown.length);
    if (end < markdown.length) {
      const newline = markdown.lastIndexOf("\n", end);
      if (newline > start + Math.floor(maxChars / 2)) {
        end = newline;
      }
    }

    chunks.push(markdown.slice(start, end).trim());
    start = end;
  }

  return chunks.filter(Boolean);
}

function mergeExtraction(base: ProjectExtractionData, next: Partial<ProjectExtractionData>) {
  const merged: ProjectExtractionData = { ...base };

  for (const [key, value] of Object.entries(next) as Array<[keyof ProjectExtractionData, ProjectExtractionData[keyof ProjectExtractionData]]>) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        merged[key] = value as never;
      }
      continue;
    }

    if (typeof value === "string") {
      if (value.trim().length > 0) {
        merged[key] = value as never;
      }
      continue;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        merged[key] = value as never;
      }
      continue;
    }

    if (typeof value === "boolean") {
      merged[key] = value as never;
    }
  }

  return merged;
}

async function runChunkedExtraction(chunkInput: TenderExtractionChunkInput) {
  return handleTenderExtractionGeneration(chunkInput);
}

export async function extractTenderAndContractDocuments(input: TenderExtractionInput): Promise<TenderExtractionResult> {
  try {
    const [tenderPages, contractPages] = await withTimeout(
      Promise.all([
        processPDFWithMistral(input.tenderUrl),
        processPDFWithMistral(input.contractUrl),
      ]),
      OCR_TIMEOUT_MS,
      "Tender and contract OCR",
    );

    const tenderMarkdown = pageBlocksToMarkdown(tenderPages);
    const contractMarkdown = pageBlocksToMarkdown(contractPages);

    if (!tenderMarkdown.trim() || !contractMarkdown.trim()) {
      return {
        status: "error",
        extracted: createEmptyProjectExtractionData(),
        message: "OCR completed, but one or both documents produced no readable markdown.",
        error: "Unable to read one or both uploaded PDFs.",
        autoFilledCount: 0,
        totalFields: Object.keys(projectExtractionSchema.parse({})).length,
      };
    }

    const tenderChunks = chunkMarkdown(tenderMarkdown, MODEL_CHUNK_CHAR_LIMIT);
    const contractChunks = chunkMarkdown(contractMarkdown, MODEL_CHUNK_CHAR_LIMIT);
    const chunkCount = Math.max(tenderChunks.length, contractChunks.length);

    let merged = createEmptyProjectExtractionData();
    const messages: string[] = [];
    let hadPartial = false;

    for (let index = 0; index < chunkCount; index += 1) {
      const chunkResult = await runChunkedExtraction({
        tenderMarkdown: tenderChunks[index] ?? "",
        contractMarkdown: contractChunks[index] ?? contractMarkdown,
        tenderFileName: input.tenderFileName,
        contractFileName: input.contractFileName,
      });

      merged = mergeExtraction(merged, chunkResult.extraction);
      messages.push(chunkResult.message);
      hadPartial = hadPartial || !chunkResult.ok;
    }

    const extracted = projectExtractionSchema.parse(merged);
    const totalFields = Object.keys(extracted).length;
    const autoFilledCount = Object.values(extracted).filter((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      if (typeof value === "number") {
        return Number.isFinite(value);
      }

      if (typeof value === "boolean") {
        return true;
      }

      return typeof value === "string" && value.trim().length > 0;
    }).length;

    return {
      status: hadPartial ? "partial" : "success",
      extracted,
      message: messages.filter(Boolean).join(" ") || "Extraction completed.",
      autoFilledCount,
      totalFields,
    };
  } catch (error) {
    return {
      status: "error",
      extracted: createEmptyProjectExtractionData(),
      message: error instanceof Error ? error.message : "Extraction failed.",
      error: error instanceof Error ? error.message : "Extraction failed.",
      autoFilledCount: 0,
      totalFields: Object.keys(projectExtractionSchema.parse({})).length,
    };
  }
}
