import type {
  DocumentText,
  DocumentTextPort,
} from "@/lib/domain/ports/document-text";
import { isOcrConfigured, ocrDocumentAtUrl } from "@/lib/ocr";
import { readWorkbookGrid } from "@/lib/spreadsheet/workbook-grid";
import { fetchStoredFile } from "@/lib/blob-port";

// How the agent's document index reads an uploaded file.
//
// - PDFs, scans and photos, Word and PowerPoint files go to Mistral OCR, which
//   fetches the public blob itself and returns markdown per page, tables kept.
// - Text, CSV, Markdown and JSON are read as they are.
// - Spreadsheets are read cell by cell through the app's one workbook reader,
//   a worksheet to a page: OCR would read a rendering of the first sheet only.
// - Anything else (video, archives, CAD) is reported unsupported, once.

/** Mistral OCR's document limit. */
export const MAX_OCR_BYTES = 50 * 1024 * 1024;
/** Text and spreadsheets are downloaded; past this they are not worth the memory. */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const OCR_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

export type DocumentReading =
  | "ocr-document"
  | "ocr-image"
  | "text"
  | "spreadsheet";

const OCR_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const OCR_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/tiff",
  "image/bmp",
]);
const TEXT_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/csv",
]);
const SPREADSHEET_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

/**
 * How a file is read, from its type and then its extension: uploads from a
 * phone or an email often arrive as application/octet-stream.
 */
export function documentReading(
  filename: string,
  mediaType: string,
): DocumentReading | null {
  const type = mediaType.toLowerCase().split(";")[0]!.trim();
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (
    OCR_DOCUMENT_TYPES.has(type)
    || ["pdf", "docx", "pptx"].includes(extension)
  )
    return "ocr-document";
  if (
    OCR_IMAGE_TYPES.has(type)
    || [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "avif",
      "gif",
      "tif",
      "tiff",
      "bmp",
    ].includes(extension)
  )
    return "ocr-image";
  if (SPREADSHEET_TYPES.has(type) || ["xlsx", "xlsm"].includes(extension))
    return "spreadsheet";
  if (TEXT_TYPES.has(type) || ["txt", "csv", "md", "json"].includes(extension))
    return "text";
  return null;
}

async function download(url: string): Promise<ArrayBuffer> {
  const response = await fetchStoredFile(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}.`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error("The file is larger than the download limit.");
  }
  const data = await response.arrayBuffer();
  if (data.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("The file is larger than the download limit.");
  }
  return data;
}

/** A worksheet as text: one line per row with cells between bars, empty rows dropped. */
export function sheetAsText(
  name: string,
  rows: readonly (readonly string[])[],
): string {
  const lines = rows
    .map((row) =>
      row
        .map((cell) => cell.replace(/\s+/g, " ").trim())
        .join(" | ")
        .replace(/(?:\s\|\s)+$/, "")
        .trim(),
    )
    .filter((line) => line.replace(/[|\s]/g, "").length > 0);
  return [`## ${name}`, ...lines].join("\n");
}

export const documentTextReader: DocumentTextPort = {
  async extract({
    url,
    filename,
    mediaType,
    sizeBytes,
  }): Promise<DocumentText> {
    const reading = documentReading(filename, mediaType);
    if (!reading) {
      return {
        reason: `Not a kind of file the index reads (${mediaType || "unknown type"}).`,
        status: "unsupported",
      };
    }

    if (reading === "ocr-document" || reading === "ocr-image") {
      if (sizeBytes !== null && sizeBytes > MAX_OCR_BYTES) {
        return { reason: "Larger than the OCR limit.", status: "unsupported" };
      }
      // Not the document's fault: it is read once the key is set.
      if (!isOcrConfigured()) {
        return { reason: "MISTRAL_AI_KEY is not set.", status: "unavailable" };
      }
      const pages = await ocrDocumentAtUrl({
        isImage: reading === "ocr-image",
        name: filename,
        timeoutMs: OCR_TIMEOUT_MS,
        url,
      });
      return { pages, status: "text" };
    }

    if (sizeBytes !== null && sizeBytes > MAX_DOWNLOAD_BYTES) {
      return {
        reason: "Larger than the download limit.",
        status: "unsupported",
      };
    }
    const data = await download(url);
    if (reading === "text") {
      return { pages: [new TextDecoder("utf-8").decode(data)], status: "text" };
    }
    const workbook = await readWorkbookGrid(data);
    return {
      pages: [...workbook.values()].map((sheet) =>
        sheetAsText(sheet.name, sheet.display),
      ),
      status: "text",
    };
  },
};
