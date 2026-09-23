import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
} from "ai";
import { z } from "zod";
import { gateway } from "@/lib/model";
import {
  buildHbcfExtractionPrompt,
  HBCF_EXTRACTION_SYSTEM_PROMPT,
} from "./hbcf-extraction-prompts";

/**
 * Single-field output. Blank-tolerant on purpose: an empty string is the
 * documented answer when the certificate does not print a number, so the
 * schema must accept it rather than force the model to invent one.
 */
export const hbcfExtractionSchema = z.object({
  hbcfInsuranceNumber: z
    .string()
    .default("")
    .describe(
      "The HBCF (Home Building Compensation Fund) certificate or policy number exactly as printed on the certificate, including any letter prefix, hyphens or slashes, and without the surrounding label text. Return an empty string if no certificate number is printed on the document — never guess, reconstruct, or substitute a licence number, ABN, date, or amount.",
    ),
});

export type HbcfExtractionData = z.infer<typeof hbcfExtractionSchema>;

export type HbcfExtractionInput = {
  markdown: string;
};

export type HbcfExtractionResult = {
  hbcfInsuranceNumber: string;
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
      model: gateway("google/gemini-2.5-flash"),
      temperature: 0.015,
      topK: 30,
      system: HBCF_EXTRACTION_SYSTEM_PROMPT,
      output: Output.object({ schema: hbcfExtractionSchema }),
      prompt: buildHbcfExtractionPrompt(input.markdown),
    });

    const parsed = hbcfExtractionSchema.parse(output);
    const hbcfInsuranceNumber = parsed.hbcfInsuranceNumber.trim();

    return {
      hbcfInsuranceNumber,
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
        message: `Structured extraction was incomplete: ${error.message}`,
        ok: false,
      };
    }

    throw error;
  }
}
