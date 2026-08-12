import {
  generateText,
  Output,
  NoObjectGeneratedError,
  TypeValidationError,
  NoOutputGeneratedError,
} from "ai";
import { z } from "zod";
import { gateway } from "@/lib/model";

// Derived copy for the Inclusions Schedule.
//
// This model NEVER writes a `spec`. The spec is the contractual sentence inside
// a fixed-price MBA contract — a sentence the model invented would be something
// Royal is then legally obliged to build, which is why offer-prefill-ai.ts
// already forbids inventing construction details.
//
// What it does write is strictly DERIVED from a spec the human already
// committed to:
//
//   summary  — the short line printed beside the price on the Investment
//              Summary page. Previously typed by hand, which meant page 4 could
//              promise "Minimalistic kitchen" while the schedule promised a
//              "Custom shaker door kitchen" in the same contract. Generating it
//              FROM the spec makes that contradiction unrepresentable.
//   category — the trade label in the schedule's Category column. A filing
//              label, not a promise. Without it a row prints "Miscellaneous".
//
// Both are reviewable and overridable by the estimator before anything is sent.

export const MAX_INCLUSION_COPY_ITEMS = 80;

const suggestionSchema = z.object({
  // Echoed back so a partial or reordered response still maps to the right row.
  index: z.number().int().min(0),
  summary: z.string(),
  category: z.string(),
});

const inclusionCopySchema = z.object({
  suggestions: z.array(suggestionSchema),
});

export type InclusionCopySuggestion = {
  readonly index: number;
  readonly summary: string;
  readonly category: string;
};

export type InclusionCopyRequestItem = {
  readonly index: number;
  readonly spec: string;
};

export type InclusionCopyResult =
  | { ok: true; suggestions: readonly InclusionCopySuggestion[] }
  | { ok: false; message: string };

const SYSTEM_PROMPT = `You write two short derived labels for line items in an Australian residential building contract's Inclusions Schedule.

For each numbered specification you are given, return:
- "summary": a punchy customer-facing line for the price page. Maximum 8 words. It must restate ONLY what the specification already says. Lead with the concrete thing (material, size, brand, quantity) where the specification names one.
- "category": the trade or element name for the schedule's Category column. 1-3 words, Title Case, e.g. "Concrete Slab", "Stone Benchtops", "Waterproofing", "Ducted Air Con".

<hard_rules>
- NEVER add a material, brand, dimension, quantity, inclusion or standard that the specification does not state. You are shortening, not designing. A detail you invent becomes a contractual obligation.
- NEVER change a stated value. If the specification says 40mm, the summary says 40mm, never 60mm.
- If a specification is vague, stay vague. A generic summary is correct; an invented specific is not.
- Australian English and Australian construction vocabulary.
- No trailing full stop on either field. No quotes. No marketing adjectives that the specification does not support ("luxury", "premium") unless the specification uses them itself.
- Return exactly one object per specification you were given, echoing its index.
</hard_rules>`;

// Draft summary + category for a batch of specifications. Batched deliberately:
// a schedule has dozens of rows and one call is both cheaper and more
// consistent in tone than one call per row.
export async function generateInclusionCopy(
  items: readonly InclusionCopyRequestItem[],
): Promise<InclusionCopyResult> {
  if (items.length === 0) {
    return { ok: true, suggestions: [] };
  }
  if (items.length > MAX_INCLUSION_COPY_ITEMS) {
    return {
      ok: false,
      message: `Too many inclusions to draft at once (${items.length}, limit ${MAX_INCLUSION_COPY_ITEMS}).`,
    };
  }

  const numbered = items
    .map((item) => `${item.index}. ${item.spec.trim()}`)
    .join("\n");

  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      // Low but not zero: these are short human-facing lines, and 0 tends to
      // produce near-identical phrasing across every row.
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      output: Output.object({ schema: inclusionCopySchema }),
      prompt: `Write a summary and category for each specification below. Shorten only — never add a detail that is not already stated.\n\n<specifications>\n${numbered}\n</specifications>`,
    });

    const parsed = inclusionCopySchema.parse(output);
    // Trust the echoed index, not array position, and drop anything that does
    // not correspond to a row we actually asked about.
    const requested = new Set(items.map((item) => item.index));
    const suggestions = parsed.suggestions
      .filter((s) => requested.has(s.index))
      .map((s) => ({
        index: s.index,
        summary: s.summary.trim(),
        category: s.category.trim(),
      }))
      .filter((s) => s.summary.length > 0 || s.category.length > 0);

    return { ok: true, suggestions };
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
