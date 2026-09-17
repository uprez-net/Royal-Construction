import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
} from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";
import { ocrPagesToText, processPDFWithMistral } from "@/lib/ocr";

/**
 * Reads the registered proprietors off a NSW title search.
 *
 * Transcription only. It returns the names as the register prints them and
 * decides nothing — whether those names are the right ones is a rule, and it
 * lives in lib/compliance/title-search-owners.ts where it can be tested without
 * a model call. Asking the model "do these match?" instead would have made the
 * one question that matters unanswerable after the fact.
 */

const titleSearchOwnerSchema = z.object({
  owners: z
    .array(z.string())
    .default([])
    .describe(
      "Every registered proprietor named on the document, transcribed exactly as printed. Empty when the document is not a title search or names none.",
    ),
  /**
   * The register's own date, where it prints one.
   *
   * Not used to decide anything today — a search can be recent and still
   * predate the transfer, so the names are the evidence and this is context for
   * whoever reads the alert.
   */
  searchDate: z
    .string()
    .optional()
    .describe(
      "The date the search was issued, exactly as printed. Omit when the document does not show one.",
    ),
  isTitleSearch: z
    .boolean()
    .default(false)
    .describe(
      "True only when this really is a title search / register folio extract. False for anything else.",
    ),
});

export type TitleSearchOwners = z.infer<typeof titleSearchOwnerSchema>;

// Matches the budget the classifier gives the same OCR endpoint.
const OCR_TIMEOUT_MS = 75_000;

// A title search is a short document and the proprietor block is on the first
// page. The cap is a guard against a scan bundled with a plan set behind it.
const MAX_MARKDOWN_CHARS = 40_000;

const INSTRUCTION = `You read NSW Land Registry Services title searches (also called a register folio extract, "Title Search Detail", or a Certificate of Title) and transcribe who the document says owns the land.

Return the names under the "FIRST SCHEDULE" / "REGISTERED PROPRIETOR" heading. That is the current owner block and the only one that matters.

Rules:
- Transcribe names exactly as printed, one entry per proprietor. Keep the register's own ordering and spelling, including surname-first formatting if that is how it appears.
- A joint ownership line such as "JOHN ANDREW SMITH AND JANE MARY SMITH AS JOINT TENANTS" is TWO proprietors. Split it. Drop the tenancy wording ("as joint tenants", "as tenants in common", share fractions).
- Companies and trustees are proprietors too. Keep the entity name whole, including "PTY LTD".
- Do NOT return names from the SECOND SCHEDULE. Those are mortgagees, caveators, easement beneficiaries and covenant holders, not owners.
- Do NOT return the name of the person or firm who ordered or printed the search, the solicitor, the surveyor, or anyone in a footer or letterhead.
- If the document is not a title search, set isTitleSearch false and return no owners.
- If it is a title search but the proprietor block is unreadable, set isTitleSearch true and return no owners. An empty list is a correct answer; never guess a name.`;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

/**
 * The proprietors on a stored title search, or null.
 *
 * Null means "could not read", and every caller treats that as no opinion
 * rather than as a failure: an unreadable scan must not raise an alert against
 * a document that may well be correct, and it must not block the upload that
 * produced it either.
 */
export async function readTitleSearchOwners(
  url: string,
  fileName?: string,
): Promise<TitleSearchOwners | null> {
  let markdown: string;
  try {
    const pages = await withTimeout(
      processPDFWithMistral(url),
      OCR_TIMEOUT_MS,
      `OCR of ${fileName ?? url}`,
    );
    markdown = ocrPagesToText(pages).trim();
  } catch (error) {
    console.error(`  OCR failed for title search "${fileName ?? url}":`, error);
    return null;
  }

  if (!markdown) {
    return null;
  }

  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: INSTRUCTION,
      temperature: 0,
      output: Output.object({ schema: titleSearchOwnerSchema }),
      prompt: [
        fileName ? `File name: ${fileName}` : "",
        "Document text:",
        markdown.slice(0, MAX_MARKDOWN_CHARS),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const parsed = titleSearchOwnerSchema.parse(output);
    return {
      ...parsed,
      // Blank entries are what a model returns when it is unsure rather than
      // when there is nothing there, and an empty string would compare against
      // everything.
      owners: parsed.owners.map((name) => name.trim()).filter(Boolean),
    };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error) ||
      TypeValidationError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    ) {
      console.error(
        `  Could not read proprietors off "${fileName ?? url}": ${error.message}`,
      );
      return null;
    }
    throw error;
  }
}
