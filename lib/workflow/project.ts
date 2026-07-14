import { processPDFWithMistral } from "@/lib/ocr";
import {
    handleTenderExtractionGeneration,
    type TenderExtractionChunkInput,
} from "@/lib/agent/tenderExtractionAgent";
import {
    createEmptyProjectExtractionData,
    projectExtractionSchema,
    type ProjectExtractionData,
} from "@/types/project-extraction";
import { getWritable, sleep } from "workflow";
import { findLeadById } from "@/lib/data/leads";
import { ObjectToMarkdown } from "@/utils/converter";
import pLimit from "p-limit";
import type { OCRPageObject } from "@mistralai/mistralai/models/components";

const limit = pLimit(4);

const OCR_TIMEOUT_MS = 75_000;
const MODEL_CHUNK_CHAR_LIMIT = 40_000;

const EXTRACTION_PROGRESS = [
    "Uploading documents",
    "Reading tender PDF",
    "Reading contract PDF",
    "Running structured extraction",
    "Preparing review",
] as const;

type ExtractionStage = (typeof EXTRACTION_PROGRESS)[number];

// Everything written to the client stream goes through this union so the
// consumer only ever has to switch on `type`.
export type TenderExtractionWorkflowStreamEvent =
    | { type: "stage"; stage: ExtractionStage; index: number; total: number }
    | { type: "result"; result: TenderExtractionResult }
    | { type: "error"; message: string };

export type TenderExtractionInput = {
    tenderUrl: string;
    contractUrl: string;
    tenderFileName: string;
    contractFileName: string;
    leadId: number;
};

export type TenderExtractionResult = {
    status: "success" | "partial" | "error";
    extracted: ProjectExtractionData;
    message: string;
    error?: string;
    autoFilledCount: number;
    totalFields: number;
};

// ---------------------------------------------------------------------------
// Pure helpers — deterministic, no I/O, safe to run directly inside the
// workflow function body (no 'use step' needed).
// ---------------------------------------------------------------------------

function normalizePageMarkdown(page: OCRPageObject, index: number) {
    let pageInfo = `\n\n--- PAGE ${index + 1} ---\n\n${page.markdown.trim()}\n\n`;
    //append table data and image anotations
    pageInfo += page.tables?.map((table) => `\n\n--- TABLE ---\n\n${table.content.trim()}\n\n`).join("") ?? "";
    pageInfo += page.images?.map((image) => `\n\n--- IMAGE ---\n\n${image.imageAnnotation ?? ""}\n\n`).join("") ?? "";

    return pageInfo;
}

function pageBlocksToMarkdown(pages: OCRPageObject[]) {
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
    for (const [key, value] of Object.entries(next) as Array<
        [keyof ProjectExtractionData, ProjectExtractionData[keyof ProjectExtractionData]]
    >) {
        if (Array.isArray(value)) {
            if (value.length > 0) merged[key] = value as never;
            continue;
        }
        if (typeof value === "string") {
            if (value.trim().length > 0) merged[key] = value as never;
            continue;
        }
        if (typeof value === "number") {
            if (Number.isFinite(value)) merged[key] = value as never;
            continue;
        }
        if (typeof value === "boolean") {
            merged[key] = value as never;
        }
    }
    return merged;
}

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

// ---------------------------------------------------------------------------
// Steps — every side-effecting/non-deterministic operation (OCR calls, model
// calls, stream writes) lives in a 'use step' function so it's checkpointed
// and replay-safe.
// ---------------------------------------------------------------------------

async function ocrDocument(url: string, label: string) {
    "use step";
    const pages = await withTimeout(processPDFWithMistral(url), OCR_TIMEOUT_MS, label);
    return pageBlocksToMarkdown(pages);
}

async function runChunkedExtraction(chunkInput: TenderExtractionChunkInput) {
    "use step";
    return handleTenderExtractionGeneration(chunkInput);
}

async function writeToStream(data: TenderExtractionWorkflowStreamEvent) {
    "use step";
    // Stream operations must happen in steps
    const writable = getWritable<TenderExtractionWorkflowStreamEvent>();
    const writer = writable.getWriter();
    try {
        await writer.write(data);
    } finally {
        writer.releaseLock();
    }
}

async function closeWorkflowStream() {
    "use step";
    try {
        await getWritable<TenderExtractionWorkflowStreamEvent>().close();
    } catch (error) {
        console.warn("Failed to close workflow stream", error);
    }
}

async function failWorkflow(message: string) {
    "use step";
    try {
        console.error(`Workflow failed: ${message}`);
        await writeToStream({ type: "error", message });
    } catch (error) {
        console.error("Error in failWorkflow:", error);
    } finally {
        await sleep(5000); // Give the client time to receive the error message
        await closeWorkflowStream();
    }
}

async function emitStage(stage: ExtractionStage) {
    const index = EXTRACTION_PROGRESS.indexOf(stage);
    await writeToStream({
        type: "stage",
        stage,
        index,
        total: EXTRACTION_PROGRESS.length,
    });
}

async function getLeadInfo(leadId: number) {
    "use step";
    const lead = await findLeadById(leadId);
    if (!lead) {
        throw new Error(`Lead with ID ${leadId} not found.`);
    }
    return ObjectToMarkdown(lead as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const extractTenderAndContractDocuments = async (
    input: TenderExtractionInput,
): Promise<TenderExtractionResult> => {
    "use workflow";
    try {
        await emitStage("Uploading documents");

        await emitStage("Reading tender PDF");
        const tenderMarkdownPromise = ocrDocument(input.tenderUrl, "Tender OCR");

        await emitStage("Reading contract PDF");
        const contractMarkdownPromise = ocrDocument(input.contractUrl, "Contract OCR");

        const [tenderMarkdown, contractMarkdown] = await Promise.all([
            tenderMarkdownPromise,
            contractMarkdownPromise,
        ]);

        if (!tenderMarkdown.trim() || !contractMarkdown.trim()) {
            const result: TenderExtractionResult = {
                status: "error",
                extracted: createEmptyProjectExtractionData(),
                message: "OCR completed, but one or both documents produced no readable markdown.",
                error: "Unable to read one or both uploaded PDFs.",
                autoFilledCount: 0,
                totalFields: Object.keys(projectExtractionSchema.parse({})).length,
            };
            await writeToStream({ type: "result", result });
            await sleep(2000);
            await closeWorkflowStream();
            return result;
        }

        await emitStage("Running structured extraction");

        const leadInfo = await getLeadInfo(input.leadId);
        const tenderChunks = chunkMarkdown(tenderMarkdown, MODEL_CHUNK_CHAR_LIMIT);
        const contractChunks = chunkMarkdown(contractMarkdown, MODEL_CHUNK_CHAR_LIMIT);
        const leadChunks = chunkMarkdown(leadInfo, MODEL_CHUNK_CHAR_LIMIT);
        const chunkCount = Math.max(tenderChunks.length, contractChunks.length, leadChunks.length);

        const chunkAt = (arr: string[], index: number) => arr[index] ?? "";

        const chunkResults = await Promise.all(
            Array.from({ length: chunkCount }, (_, i) =>
                limit(() =>
                    runChunkedExtraction({
                        tenderMarkdown: chunkAt(tenderChunks, i),
                        contractMarkdown: chunkAt(contractChunks, i),
                        tenderFileName: input.tenderFileName,
                        contractFileName: input.contractFileName,
                        leadInfo: chunkAt(leadChunks, i),
                    })
                )
            )
        );

        let merged = createEmptyProjectExtractionData();
        const messages: string[] = [];
        let hadPartial = false;

        for (const chunkResult of chunkResults) {
            merged = mergeExtraction(merged, chunkResult.extraction);
            messages.push(chunkResult.message);
            hadPartial ||= !chunkResult.ok;
        }

        await emitStage("Preparing review");

        const extracted = projectExtractionSchema.parse(merged);
        const totalFields = Object.keys(extracted).length;
        const autoFilledCount = Object.values(extracted).filter((value) => {
            if (Array.isArray(value)) return value.length > 0;
            if (typeof value === "number") return Number.isFinite(value);
            if (typeof value === "boolean") return true;
            return typeof value === "string" && value.trim().length > 0;
        }).length;

        const result: TenderExtractionResult = {
            status: hadPartial ? "partial" : "success",
            extracted,
            message: messages.filter(Boolean).join(" ") || "Extraction completed.",
            autoFilledCount,
            totalFields,
        };

        await writeToStream({ type: "result", result });
        await sleep(2000);
        await closeWorkflowStream();
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Extraction failed.";
        await failWorkflow(message);
        throw new Error(`Failed to extract tender/contract documents: ${message}`);
    }
};