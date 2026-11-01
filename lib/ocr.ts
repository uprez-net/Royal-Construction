import { Mistral } from "@mistralai/mistralai";
import type { OCRPageObject } from "@mistralai/mistralai/models/components";

// Checked at call time rather than on import. The Graph webhook now reaches
// this module, and a module-scope throw would take the whole route down at
// import — turning a missing OCR key into dropped leads instead of leads
// extracted without OCR.
function requireApiKey(): string {
  const apiKey = process.env.MISTRAL_AI_KEY;
  if (!apiKey) {
    throw new Error("MISTRAL_AI_KEY is not set in the environment variables.");
  }
  return apiKey;
}

export function isOcrConfigured(): boolean {
  return Boolean(process.env.MISTRAL_AI_KEY);
}

export async function processPDFWithMistral(
  pdfLink: string,
  /** Abandons the call rather than letting one slow scan hold the caller open. */
  options: { readonly timeoutMs?: number } = {},
) {
  const client = new Mistral({ apiKey: requireApiKey() });

  try {
    const response = await client.ocr.process(
      {
        model: "mistral-ocr-latest",
        document: {
          type: "document_url",
          documentUrl: pdfLink,
        },
        includeImageBase64: false,
        tableFormat: "markdown",
      },
      options.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined,
    );

    return response.pages;
  } catch (error) {
    console.error("Mistral OCR failed:", error);
    throw error;
  }
}

/**
 * Flattens OCR pages into one markdown string.
 *
 * Tables come back beside `markdown` rather than inside it, so joining on the
 * page text alone silently drops every schedule and dimension table — the part
 * of a plan set most worth reading.
 */
export function ocrPagesToText(pages: OCRPageObject[]): string {
  return pages
    .map((page) => {
      const tables =
        page.tables?.map((table) => table.content.trim()).join("\n\n") ?? "";
      return [page.markdown.trim(), tables].filter(Boolean).join("\n\n");
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export interface OcrInput {
  /** Filename as the sender wrote it. Mistral reads the extension off it to pick a parser. */
  name: string;
  mediaType: string;
  data: Buffer;
  /** True for a still image, which goes to the OCR endpoint as an image rather than a document. */
  isImage: boolean;
  /** Abandons the call rather than letting one slow scan hold the caller open. */
  timeoutMs?: number;
}

/**
 * Runs OCR over bytes we already hold, rather than a URL Mistral can fetch.
 *
 * An email attachment never has a public URL — it lives in the mailbox until we
 * download it — so the bytes go up as a data URI. `documentName` carries the
 * extension, which is how Mistral decides whether it is unpacking a PDF or a
 * .docx; without it a Word file is rejected as an unknown format.
 */
export async function ocrFile({
  name,
  mediaType,
  data,
  isImage,
  timeoutMs,
}: OcrInput): Promise<string> {
  const client = new Mistral({ apiKey: requireApiKey() });
  const dataUri = `data:${mediaType};base64,${data.toString("base64")}`;

  const response = await client.ocr.process(
    {
      model: "mistral-ocr-latest",
      document: isImage
        ? { type: "image_url", imageUrl: dataUri }
        : { type: "document_url", documentUrl: dataUri, documentName: name },
      includeImageBase64: false,
      tableFormat: "markdown",
    },
    timeoutMs ? { timeoutMs } : undefined,
  );

  return ocrPagesToText(response.pages);
}
