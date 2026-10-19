import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  TypeValidationError,
} from "ai";
import { z } from "zod";

import { gateway } from "@/lib/model";
import type {
  WorkDetailsDraft,
  WorkDetailsDraftInput,
} from "@/lib/domain/ports/tradie-request-ai";

// Drafts the "Work details" lines under each activity in a tradie request.
//
// A tradie prices what the email says. So the model only restates and breaks
// down the work an activity name already implies for that trade; it never
// invents a quantity, a dimension, a brand or a site condition, because a
// number it made up would be quoted against. Every line is reviewed and
// editable before anything is sent.

const MAX_LINES_PER_ACTIVITY = 6;

const draftSchema = z.object({
  items: z.array(
    z.object({
      milestoneId: z.string(),
      lines: z.array(z.string()),
    }),
  ),
});

const SYSTEM_PROMPT = `You write the scope-of-works lines for a request for quotation that an Australian residential builder emails to a trade contractor.

For each activity you are given, write 2 to 5 short lines describing the work the contractor is being asked to price for that activity, from the point of view of their trade.

<hard_rules>
- Use only what the activity name, its stage, its description and the project details imply. Never invent quantities, dimensions, counts, brands, product codes, site conditions or dates.
- Where pricing depends on something not given, write a line asking the contractor to state it (for example "Allow for and state any exclusions"), rather than assuming a value.
- If the activity does not obviously involve this trade, write a single line asking the contractor to confirm what, if anything, they would price for it. Never tell them the work is out of scope: the email is a request, not a judgement.
- Each line is one plain sentence fragment, under 110 characters, no numbering, no bullet characters, no trailing full stop.
- Australian English. Australian construction terms (e.g. "fit-off", "rough-in", "lock-up").
- Return exactly one item per activity, echoing its milestoneId verbatim.
</hard_rules>`;

/** "Interior_Fit_Out" → "Interior Fit Out". */
function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}

function cleanLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/\.$/, "")
    .trim();
}

export async function draftTradieRequestWorkDetailsWithAi(
  input: WorkDetailsDraftInput,
): Promise<WorkDetailsDraft> {
  const activities = input.activities
    .map(
      (activity) =>
        `<activity milestoneId="${activity.milestoneId}">\nName: ${activity.name}\nStage: ${stageLabel(activity.stage)}\nDescription: ${activity.description?.trim() || "(none)"}\n</activity>`,
    )
    .join("\n");

  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      output: Output.object({ schema: draftSchema }),
      prompt: `Trade: ${input.trade}\nBuilding: ${input.buildingType}\nProject notes: ${input.projectDescription?.trim() || "(none)"}\n\n${activities}`,
    });

    const parsed = draftSchema.parse(output);
    const known = new Set(input.activities.map((a) => a.milestoneId));
    const items = parsed.items
      // An id the model made up would attach lines to nothing on screen.
      .filter((item) => known.has(item.milestoneId))
      .map((item) => ({
        milestoneId: item.milestoneId,
        lines: item.lines
          .map(cleanLine)
          .filter((line) => line.length > 0)
          .slice(0, MAX_LINES_PER_ACTIVITY),
      }));

    return { ok: true, items };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error)
      || TypeValidationError.isInstance(error)
      || NoOutputGeneratedError.isInstance(error)
    ) {
      return {
        ok: false,
        message:
          "The draft could not be generated. Write the work details by hand, or try again.",
      };
    }
    throw error;
  }
}
