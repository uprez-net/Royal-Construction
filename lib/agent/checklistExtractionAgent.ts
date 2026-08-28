import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
} from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";

/**
 * The extracted checklist.
 *
 * Items come back as a flat list of strings rather than as objects with an
 * order: the order is the array's, which is one less thing the model can get
 * wrong. It is materialised into the `order` column by the caller.
 */
export const checklistExtractionSchema = z.object({
  items: z
    .array(
      z
        .string()
        .describe(
          "One required item, transcribed in the certifier's own words with its leading number or bullet removed.",
        ),
    )
    .default([])
    .describe(
      "Every item the certifier lists as required, in the order they appear on the document. Return an empty array if the document is not a checklist — never invent items to fill out a short list.",
    ),
});

export type ChecklistExtractionData = z.infer<typeof checklistExtractionSchema>;

export type ChecklistExtractionAgentInput = {
  system: string;
  prompt: string;
};

export type ChecklistExtractionAgentResult = {
  items: { label: string; order: number }[];
  message: string;
  ok: boolean;
};

// A checklist with more entries than this is not a checklist — it is a whole
// specification the model has mistaken for one, and turning it into that many
// tracked rows would make the tab unusable. Truncated rather than rejected so
// the admin still gets something to work with.
const MAX_CHECKLIST_ITEMS = 100;

/**
 * Reads a certifier's checklist out of its OCR markdown.
 *
 * Never throws for a model-side failure: a checklist the model cannot parse
 * degrades to an empty list with `ok: false`, so the workflow can report "no
 * items could be read" and leave the document in place for someone to work
 * through by hand. Anything else — a gateway outage, a bad key — is rethrown
 * so the step's retry sees it.
 */
export async function runChecklistExtraction(
  input: ChecklistExtractionAgentInput,
): Promise<ChecklistExtractionAgentResult> {
  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      temperature: 0.015,
      topK: 30,
      system: input.system,
      output: Output.object({ schema: checklistExtractionSchema }),
      prompt: input.prompt,
    });

    const parsed = checklistExtractionSchema.parse(output);

    const items = parsed.items
      .map((label) => label.trim())
      .filter((label) => label.length > 0)
      .slice(0, MAX_CHECKLIST_ITEMS)
      .map((label, index) => ({ label, order: index }));

    return {
      items,
      message: items.length
        ? `Read ${items.length} checklist item${items.length === 1 ? "" : "s"}.`
        : "No checklist items were found on the document.",
      ok: true,
    };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error) ||
      TypeValidationError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    ) {
      return {
        items: [],
        message: `Checklist extraction was incomplete: ${error.message}`,
        ok: false,
      };
    }

    throw error;
  }
}
