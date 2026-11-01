import { generateText, Output } from "ai";
import { z } from "zod";

import type {
  TradieInvoiceDocumentFields,
  TradieInvoiceDocumentReader,
} from "@/lib/domain/tradies/invoice-document";
import { gateway, TEXT_MODEL_ID } from "@/lib/model";
import { ocrFile, ocrPagesToText, processPDFWithMistral } from "@/lib/ocr";

// Reads a tradie's invoice so the Record invoice form fills itself in. OCR
// first (Mistral, which reads scans and photos as well as born-digital PDFs),
// then a structured read of the text. Every field is a suggestion the office
// reviews; a blank is the right answer for anything not printed.

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
    return ocrPagesToText(await processPDFWithMistral(input.url));
  }
  const response = await fetch(input.url);
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

export const readTradieInvoiceWithAi: TradieInvoiceDocumentReader = async (
  input,
): Promise<TradieInvoiceDocumentFields> => {
  const text = (await invoiceText(input)).slice(0, MAX_OCR_CHARS);
  if (!text.trim()) {
    throw new Error("No text could be read from the invoice.");
  }
  const { output } = await generateText({
    model: gateway(TEXT_MODEL_ID),
    output: Output.object({ schema: tradieInvoiceExtractionSchema }),
    prompt: `Extract the invoice details from this OCR text of "${input.fileName}".\n\n<invoice>\n${text}\n</invoice>`,
    system: SYSTEM_PROMPT,
  });
  return tradieInvoiceExtractionSchema.parse(output);
};
