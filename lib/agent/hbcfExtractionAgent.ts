import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
} from "ai";
import { z } from "zod";
import { gateway, TEXT_MODEL_ID } from "@/lib/model";
import { normalizeIsoDate } from "@/lib/projects/insurance-claim-dates";
import { normalizeClaimAmount } from "@/lib/domain/insurance/hbcf-claims";
import {
  buildHbcfExtractionPrompt,
  HBCF_EXTRACTION_SYSTEM_PROMPT,
} from "./hbcf-extraction-prompts";

/**
 * The number and the date cover starts. Blank-tolerant on purpose: an empty
 * string is the documented answer when the certificate does not print one, so
 * the schema must accept it rather than force the model to invent one.
 */
export const hbcfExtractionSchema = z.object({
  hbcfInsuranceNumber: z
    .string()
    .default("")
    .describe(
      "The HBCF (Home Building Compensation Fund) certificate or policy number exactly as printed on the certificate, including any letter prefix, hyphens or slashes, and without the surrounding label text. Return an empty string if no certificate number is printed on the document — never guess, reconstruct, or substitute a licence number, ABN, date, or amount.",
    ),
  coverStartDate: z
    .string()
    .default("")
    .describe(
      "The date HBCF cover starts, as printed on the certificate (the start of the period of cover, or the issue date when the certificate prints no separate start), converted to yyyy-MM-dd. Australian certificates print day before month: 03/04/2026 is 2026-04-03. Return an empty string if no such date is printed — never use the contract date, an expiry date, or today's date.",
    ),
  claimAmount: z
    .string()
    .default("")
    .describe(
      'The amount this HBCF certificate covers, as printed (usually labelled "Contract price", "Contract value" or "Amount insured"), as a plain number in Australian dollars with no currency symbol or thousands separators, e.g. 485000 or 2500.50. Return an empty string if no such amount is printed — never return the premium, the GST, a fee, or a total you calculated.',
    ),
});

export type HbcfExtractionData = z.infer<typeof hbcfExtractionSchema>;

export type HbcfExtractionInput = {
  markdown: string;
};

export type HbcfExtractionResult = {
  hbcfInsuranceNumber: string;
  /** `yyyy-MM-dd`, or "" when the certificate prints no readable start date. */
  coverStartDate: string;
  /**
   * AUD, or null when no amount was printed or it was unreadable. Always an
   * unconfirmed reading: the Overview asks a person to confirm it before it
   * counts toward the project's HBCF claim total.
   */
  claimAmount: number | null;
  message: string;
  ok: boolean;
};

/**
 * Reads the HBCF certificate number out of a certificate's OCR markdown.
 *
 * Never throws for a model-side failure: a certificate the model cannot parse
 * degrades to a blank number with `ok: false`, so the caller can keep the
 * uploaded document linked and let the user type the number in by hand.
 * @param input - OCR markdown for the uploaded certificate.
 * @returns The extracted number (possibly blank) and whether extraction succeeded.
 */
export async function handleHbcfExtractionGeneration(
  input: HbcfExtractionInput,
): Promise<HbcfExtractionResult> {
  try {
    const { output } = await generateText({
      model: gateway(TEXT_MODEL_ID),
      system: HBCF_EXTRACTION_SYSTEM_PROMPT,
      output: Output.object({ schema: hbcfExtractionSchema }),
      prompt: buildHbcfExtractionPrompt(input.markdown),
    });

    const parsed = hbcfExtractionSchema.parse(output);
    const hbcfInsuranceNumber = parsed.hbcfInsuranceNumber.trim();
    // Checked rather than trusted: a malformed or impossible date is worse
    // than none, because it would be offered to the office as a reading.
    const coverStartDate = normalizeIsoDate(parsed.coverStartDate) ?? "";
    // Same: a figure that does not parse as a positive amount is no reading.
    const claimAmount = normalizeClaimAmount(
      parsed.claimAmount.replace(/[$,\s]/g, ""),
    );

    return {
      hbcfInsuranceNumber,
      coverStartDate,
      claimAmount,
      message: hbcfInsuranceNumber
        ? "HBCF insurance number extracted successfully."
        : "No HBCF insurance number was printed on the document.",
      ok: true,
    };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error)
      || TypeValidationError.isInstance(error)
      || NoOutputGeneratedError.isInstance(error)
    ) {
      return {
        hbcfInsuranceNumber: "",
        coverStartDate: "",
        claimAmount: null,
        message: `Structured extraction was incomplete: ${error.message}`,
        ok: false,
      };
    }

    throw error;
  }
}
