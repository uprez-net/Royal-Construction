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
 * Reads the estate developer off a land deed, where the deed names one.
 *
 * The fallback half of a question somebody otherwise has to be asked. A lot
 * released as part of a master-planned estate routinely carries a covenant: the
 * developer's own consultant signs off the bushfire assessment and the
 * architectural design before either goes to a council or a certifier. Nothing
 * on a 10.7 certificate or a title search says reliably whether that covenant
 * exists, so the answer used to come from one place — an admin picking the estate
 * out of a checked-in list — and an estate missing from that list left a job with
 * a covenant it could not record.
 *
 * The deed is where the answer actually is. It is the instrument that names
 * whoever released the land, it is already on the file by the time a surveyor is
 * engaged, and reading it costs a single OCR pass on a document the job has
 * already paid to store.
 *
 * Transcription only, on the same principle as `titleSearchOwnerAgent`: it returns
 * what the deed says and decides nothing. Whether a developer's approval is then
 * sought is a rule, and it lives in `recordEstateDeveloperFromDeed` where a
 * person's own answer outranks anything read here.
 *
 * Deliberately narrow, and the narrowness is load-bearing. A deed is thick with
 * names — the vendor, the purchaser, the mortgagee, the solicitors who drew it,
 * the surveyor who plotted the plan, a caveator — and all but one of them would
 * be wrong. Returning nothing is the correct and common answer.
 */

const landDeedDeveloperSchema = z.object({
  /**
   * The company that released the land, exactly as the deed prints it.
   *
   * Null rather than a guess, which is most of the point of this schema. A deed
   * with no estate behind it — the ordinary case for an established suburb — names
   * a private vendor, and reading that vendor as a developer would put a covenant
   * on a job that has none and hold its lodgement behind an approval nobody can
   * give.
   */
  developerName: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "The development or estate company that released the land, transcribed exactly as printed, including 'PTY LTD'. Null when the deed names no such company.",
    ),
  /**
   * The estate as the deed names it, for the screen rather than for matching.
   *
   * Nothing keys on it. It is shown beside the developer so whoever reads the
   * banner can recognise the estate they are standing in, which is how a wrong
   * answer gets spotted.
   */
  estate: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "The name of the estate or release the lot belongs to, as printed. Null when the deed does not name one.",
    ),
  developerEmail: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "An email address for the developer, only where the deed prints one against them. Null otherwise — never a solicitor's or an agent's.",
    ),
  developerPhone: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "A phone number for the developer, only where the deed prints one against them. Null otherwise.",
    ),
  /**
   * Whether this is a land deed at all.
   *
   * Read because the caller runs this behind an upload to a row an admin chose,
   * and a row labelled LAND_DEED can hold whatever was dragged onto it. A
   * contract of sale or a survey plan has names on it too, and none of them is a
   * developer.
   */
  isLandDeed: z
    .boolean()
    .default(false)
    .describe(
      "True only when this really is a land deed, certificate of title, transfer or contract of sale for land. False for anything else.",
    ),
});

export type LandDeedDeveloper = z.infer<typeof landDeedDeveloperSchema>;

/** Matches the budget the classifier gives the same OCR endpoint. */
const OCR_TIMEOUT_MS = 75_000;

/**
 * A deed is short and the parties are on the first pages.
 *
 * The cap is a guard against a scan bundled with a deposited plan behind it,
 * which is how these routinely arrive.
 */
const MAX_MARKDOWN_CHARS = 40_000;

const INSTRUCTION = `You read Australian land deeds, certificates of title, transfers and contracts of sale, and transcribe the name of the DEVELOPMENT COMPANY that released the land, where the document names one.

You are looking for the company behind a master-planned estate or land release — the entity that subdivided the land and sold the lot, and whose covenant a builder has to satisfy. Typical names read like "Example Land Developments Pty Ltd", "Elara Estate Pty Ltd", "XYZ Property Group Pty Ltd", and they appear as the vendor or transferor on a lot in a recent deposited plan, or in a restrictive covenant, a positive covenant, or an estate design-guidelines clause.

Rules:
- Transcribe the name exactly as printed, including "PTY LTD", "LIMITED" or "NO. 2".
- Return the DEVELOPER only. Never the purchaser or transferee, never the mortgagee or bank, never the solicitors or conveyancers who drew the document, never the surveyor who prepared the plan, never a real estate agency, never a caveator or easement beneficiary, and never a name in a letterhead or footer.
- A private individual selling an established house is NOT a developer. If the vendor is a person rather than a development company, return null.
- An estate name on its own is not a developer. Put it in "estate" and leave "developerName" null unless the company is also printed.
- Return an email or phone ONLY when the document prints it against the developer. A solicitor's contact details are not the developer's.
- If the document is not a land deed or title document, set isLandDeed false and return nulls.
- If it is one but names no development company, set isLandDeed true and return null for developerName. An empty answer is correct and is the common case — most lots are not in a master-planned estate. Never guess.`;

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
 * The developer on a stored land deed, or null.
 *
 * Null means "no opinion", and every caller treats it that way: an unreadable
 * scan must not set a covenant on a job, and it must not clear one either. The
 * banner on the tab stays up, which is the right outcome — it is the thing that
 * gets the question answered properly.
 *
 * Shaped as `{ name, email, phone }` rather than returning the schema whole,
 * because the caller writes three columns and the estate name is context for the
 * prompt's own benefit rather than something the file stores. A result with no
 * name is returned as null, so a caller never has to ask twice whether it found
 * anybody.
 */
export async function readLandDeedDeveloper(file: {
  url: string;
  filename?: string;
}): Promise<{
  name: string;
  email: string | null;
  phone: string | null;
} | null> {
  const label = file.filename ?? file.url;

  let markdown: string;
  try {
    const pages = await withTimeout(
      processPDFWithMistral(file.url),
      OCR_TIMEOUT_MS,
      `OCR of ${label}`,
    );
    markdown = ocrPagesToText(pages).trim();
  } catch (error) {
    console.error(`  OCR failed for land deed "${label}":`, error);
    return null;
  }

  if (!markdown) return null;

  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      system: INSTRUCTION,
      temperature: 0,
      output: Output.object({ schema: landDeedDeveloperSchema }),
      prompt: [
        file.filename ? `File name: ${file.filename}` : "",
        "Document text:",
        markdown.slice(0, MAX_MARKDOWN_CHARS),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const parsed = landDeedDeveloperSchema.parse(output);

    // Both conditions, and the first is the one that matters. A row labelled as a
    // land deed can hold whatever was dragged onto it, and a contract of sale or a
    // survey plan has company names on it that are nobody's developer.
    if (!parsed.isLandDeed) return null;

    const name = parsed.developerName?.trim() || null;
    if (!name) return null;

    return {
      name,
      // Blank strings are what a model returns when it is unsure rather than when
      // there is nothing there, and a blank address would look like a developer we
      // could write to.
      email: parsed.developerEmail?.trim() || null,
      phone: parsed.developerPhone?.trim() || null,
    };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error)
      || TypeValidationError.isInstance(error)
      || NoOutputGeneratedError.isInstance(error)
    ) {
      console.error(
        `  Could not read a developer off "${label}": ${error.message}`,
      );
      return null;
    }
    console.error(`  Failed to read the land deed "${label}":`, error);
    return null;
  }
}
