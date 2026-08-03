import {
  generateText,
  Output,
  NoObjectGeneratedError,
  TypeValidationError,
  NoOutputGeneratedError,
} from "ai";
import { z } from "zod";
import { gateway } from "@/lib/model";
import { FACADE_OPTIONS } from "@/lib/offer/workspace-model";

const FACADE_VALUES = FACADE_OPTIONS.map((option) => option.value);
// "" = no façade evidenced (the model must not guess one).
const FACADE_ENUM = ["", ...FACADE_VALUES] as [string, ...string[]];

// AI pre-fill for the offer workspace — Phase 1 (text-only). Reads a lead's
// conversation/notes and drafts the FACTUAL, descriptive job fields the
// estimator would otherwise type from scratch. It never touches pricing, cost
// lines, allowances or the payment schedule — those are business decisions.
//
// Output is always a DRAFT for the estimator to review, never authoritative:
// the prompt forbids fabrication and asks for "" / [] when a fact is not
// evidenced in the lead context.
export const offerPrefillSchema = z.object({
  buildType: z
    .string()
    .describe(
      "Short descriptive build type for the proposal, e.g. 'Custom Double Storey Residence', 'Single Storey Home', 'Duplex', 'Granny Flat'. Empty string if the lead gives no clear indication.",
    ),
  buildScope: z
    .array(z.string())
    .describe(
      "Short customer-facing feature bullets describing the scope the client has discussed (e.g. '4 Bedrooms + Study', 'Double Garage', 'Alfresco', 'Butler's Pantry'). Only include features actually mentioned in the lead context. Empty array if none are evidenced.",
    ),
  facade: z
    .enum(FACADE_ENUM)
    .describe(
      `The façade style/material ONLY if the lead clearly indicates one — must be exactly one of: ${FACADE_VALUES.join(", ")}. Empty string if the lead does not mention a façade style or material.`,
    ),
  introText: z
    .string()
    .describe(
      "A 1-2 sentence warm, professional proposal introduction tailored to what this client has asked for. Do not invent specifics; keep it general if the context is thin. Empty string to fall back to the standard template.",
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe(
      "How well the lead context supported these fields. 'low' when the context was thin/ambiguous.",
    ),
  notesForEstimator: z
    .string()
    .describe(
      "One short line stating what was inferred and what is still missing/assumed, so the estimator knows what to verify. Empty string if nothing noteworthy.",
    ),
  numberOfBedrooms: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "The number of bedrooms the client has discussed. 0 if none are mentioned.",
    ),
  numberOfBathrooms: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "The number of bathrooms the client has discussed. 0 if none are mentioned.",
    ),
  numberOfGarageSpaces: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "The number of garage spaces the client has discussed. 0 if none are mentioned.",
    ),
});

export type OfferPrefillDraft = z.infer<typeof offerPrefillSchema>;

const SYSTEM_PROMPT = `You are an assistant for Royal Constructions Pty Ltd, a NSW residential home builder. You pre-fill the FACTUAL, descriptive fields of a building-offer workspace from a sales lead's context (contact record, sales notes, and email conversation).

<what_to_produce>
- buildType: a short descriptive label for the build.
- buildScope: short customer-facing feature bullets for what the client wants built.
- facade: the façade style/material, but ONLY when the lead clearly indicates one (e.g. mentions "Hamptons", "rendered", "face brick", "coastal", "contemporary") — pick the closest allowed option, otherwise leave it "".
- introText: a brief, warm proposal introduction tailored to this client.
- confidence + notesForEstimator: your self-assessment.
</what_to_produce>

<hard_rules>
- These are DRAFTS an estimator will review. Accuracy over completeness.
- NEVER fabricate, guess, or "fill in" plausible construction details that are not evidenced in the lead context. If a field is not supported, return "" (empty string) or [] (empty array).
- Do NOT produce prices, dollar amounts, allowances, quantities, or a payment schedule — those are estimator decisions and out of scope.
- Do NOT invent a site address, lot number, zoning, or floor areas — those come from documents, not this text pass. Leave anything you are unsure about blank.
- buildScope bullets must be short (a few words each), customer-facing, and drawn only from features the client actually discussed.
- Keep introText professional and generic if the context is thin; never assert facts you cannot support.
</hard_rules>`;

export type OfferPrefillDraftResult =
  | { ok: true; draft: OfferPrefillDraft }
  | { ok: false; message: string };

export async function generateOfferPrefillDraft(
  leadContextMarkdown: string,
): Promise<OfferPrefillDraftResult> {
  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      output: Output.object({ schema: offerPrefillSchema }),
      prompt: `Draft the offer pre-fill fields from this lead's context. Follow the hard rules — blank is better than wrong.\n\n<lead_context>\n${leadContextMarkdown}\n</lead_context>`,
    });
    return { ok: true, draft: offerPrefillSchema.parse(output) };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error) ||
      TypeValidationError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    ) {
      return { ok: false, message: (error as Error).message };
    }
    throw error;
  }
}
