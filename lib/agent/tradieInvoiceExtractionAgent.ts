import { generateText, Output } from "ai";
import { z } from "zod";

import type {
  TradieInvoiceDocumentFields,
  TradieInvoiceDocumentReader,
} from "@/lib/domain/tradies/invoice-document";
import { gateway, TEXT_MODEL_ID } from "@/lib/model";
import { ocrFile, ocrPagesToText, processPDFWithMistral } from "@/lib/ocr";
import { fetchStoredFile } from "@/lib/blob-port";

// Reads a tradie's invoice so the Record invoice form fills itself in. OCR
// first (Mistral, which reads scans and photos as well as born-digital PDFs),
// then a structured read of the text. Every field is a suggestion the office
// reviews; a blank is the right answer for anything not printed.

// Every outside call is bounded: the office is watching a "Reading the
// invoice…" spinner, and a hung provider must give up rather than hold it.
const OCR_TIMEOUT_MS = 45_000;
const MAX_OCR_CHARS = 40_000;

const amount = (description: string) =>
  z
    .number()
    .nullable()
    .default(null)
    .describe(
      `${description} In dollars as a plain number (1234.5), no currency symbol. Null if it is not printed — never compute or guess one.`,
    );

const isoDay = (description: string) =>
  z
    .string()
    .nullable()
    .default(null)
    .describe(
      `${description} As YYYY-MM-DD. Australian invoices write dates day first: 03/04/2026 is 3 April 2026. Null if not printed.`,
    );

export const tradieInvoiceExtractionSchema = z.object({
  documentKind: z
    .enum(["INVOICE", "QUOTE", "STATEMENT", "OTHER"])
    .default("OTHER")
    .describe(
      "What the document is. INVOICE only for a tax invoice asking to be paid for work or materials. A quote or estimate is QUOTE; an account statement listing several invoices is STATEMENT; a receipt, remittance, plan, photo of work or anything else is OTHER.",
    ),
  invoiceNumber: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'The invoice number exactly as printed, without the label ("INV-0042", not "Invoice No: INV-0042"). Not an ABN, a quote number, a purchase order or a job number. Null if none is printed.',
    ),
  issuedDate: isoDay("The invoice (issue) date."),
  dueDate: isoDay("The payment due date."),
  subTotal: amount("The total EXCLUDING GST (the subtotal)."),
  totalTax: amount("The GST amount. 0 if the invoice states no GST applies."),
  total: amount("The total INCLUDING GST (the amount due)."),
  supplierName: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "The business that issued the invoice — the tradie, not the customer it is billed to (Royal Constructions is the customer). Null if unclear.",
    ),
});

const SYSTEM_PROMPT = `You read supplier invoices sent to Royal Constructions, an Australian residential builder, by its tradespeople.
Extract only what is printed on the invoice. Never infer, compute or invent a value: a field that is not printed is null.
Amounts are Australian dollars. Royal Constructions is always the customer, never the supplier.`;

async function invoiceText(input: {
  url: string;
  fileName: string;
  contentType: string;
}): Promise<string> {
  if (input.contentType === "application/pdf") {
    return ocrPagesToText(
      await processPDFWithMistral(input.url, { timeoutMs: OCR_TIMEOUT_MS }),
    );
  }
  const response = await fetchStoredFile(input.url, {
    signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `The uploaded invoice could not be fetched (${response.status}).`,
    );
  }
  return ocrFile({
    data: Buffer.from(await response.arrayBuffer()),
    isImage: true,
    mediaType: input.contentType,
    name: input.fileName,
    timeoutMs: OCR_TIMEOUT_MS,
  });
}

export type TradieInvoiceReading = z.infer<
  typeof tradieInvoiceExtractionSchema
>;

/** The structured read of an invoice's OCR text, bounded like the OCR. */
async function readInvoiceText(
  ocrText: string,
  fileName: string,
): Promise<TradieInvoiceReading> {
  const text = ocrText.slice(0, MAX_OCR_CHARS);
  if (!text.trim()) {
    throw new Error("No text could be read from the invoice.");
  }
  const { output } = await generateText({
    abortSignal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    model: gateway(TEXT_MODEL_ID),
    output: Output.object({ schema: tradieInvoiceExtractionSchema }),
    prompt: `Extract the invoice details from this OCR text of "${fileName}".\n\n<invoice>\n${text}\n</invoice>`,
    system: SYSTEM_PROMPT,
  });
  return tradieInvoiceExtractionSchema.parse(output);
}

export const readTradieInvoiceWithAi: TradieInvoiceDocumentReader = async (
  input,
): Promise<TradieInvoiceDocumentFields> =>
  readInvoiceText(await invoiceText(input), input.fileName);

/**
 * Read an email attachment we already hold the bytes of: what the document
 * is, and the invoice's details if it is one.
 */
export async function readTradieInvoiceBytes(input: {
  readonly data: Buffer;
  readonly fileName: string;
  readonly contentType: string;
}): Promise<TradieInvoiceReading> {
  const text = await ocrFile({
    data: input.data,
    isImage: input.contentType.startsWith("image/"),
    mediaType: input.contentType,
    name: input.fileName,
    timeoutMs: OCR_TIMEOUT_MS,
  });
  // A photo of the work, or a scan with no printed text, is not an invoice.
  // Throwing here would make the workflow step retry the OCR call.
  if (!text.trim()) return tradieInvoiceExtractionSchema.parse({});
  return readInvoiceText(text, input.fileName);
}
