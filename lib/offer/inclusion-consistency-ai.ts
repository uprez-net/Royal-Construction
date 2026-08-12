import {
  generateText,
  Output,
  NoObjectGeneratedError,
  TypeValidationError,
  NoOutputGeneratedError,
} from "ai";
import { z } from "zod";
import { gateway } from "@/lib/model";

// Consistency check across the three lists on an offer.
//
//   PRICED   — cost schedule (Step 2). What has money against it.
//   PROMISED — inclusions schedule (Step 5). What the contract commits to.
//   SOLD     — "This price includes" (Step 5, top). What the client is pitched.
//
// The rule: priced → promised → sold. Never sell what is not promised; never
// promise what is not priced.
//
// The model ONLY JUDGES. It never writes a spec, a highlight, or a category.
// Everything it returns is a finding for a human to act on, because a sentence
// it wrote would be a contractual obligation Royal has to build.

const findingSchema = z.object({
  kind: z.enum(["priced-not-promised", "sold-not-promised"]),
  // The cost line or selling line the finding is about, echoed back verbatim.
  source: z.string(),
  // Plain-language statement of what is wrong.
  detail: z.string(),
  // 1-based inclusion schedule rows that bear on it. May be empty.
  scheduleRows: z.array(z.number().int().positive()),
});

const consistencySchema = z.object({
  findings: z.array(findingSchema),
});

export type ConsistencyFindingKind = z.infer<typeof findingSchema>["kind"];

export type ConsistencyFinding = {
  readonly kind: ConsistencyFindingKind;
  readonly source: string;
  readonly detail: string;
  readonly scheduleRows: readonly number[];
};

export type ConsistencyCheckInput = {
  // Offer/tender wording of every INCLUDED, PRICED cost line.
  readonly pricedItems: readonly string[];
  // The contractual schedule, in order. Index + 1 is the printed row number.
  readonly promised: readonly string[];
  // The selling lines beside the price.
  readonly sold: readonly string[];
};

export type ConsistencyCheckResult =
  | { ok: true; findings: readonly ConsistencyFinding[] }
  | { ok: false; message: string };

const SYSTEM_PROMPT = `You audit an Australian fixed-price residential building offer for internal consistency.

You are given three lists:
- PRICED: cost items the builder has money against.
- PROMISED: the contractual Inclusions Schedule the client signs.
- SOLD: the short selling lines printed beside the price.

Report only two kinds of problem:
- "priced-not-promised": something in PRICED that the schedule never commits to. The builder has costed work the contract does not mention.
- "sold-not-promised": something in SOLD that the schedule does not support. The client is being sold something the contract does not commit to.

<hard_rules>
- JUDGE ONLY. Never rewrite, never suggest replacement wording, never author a specification. Your output is findings for a human.
- One SOLD line routinely covers SEVERAL schedule rows. "All structural works — slab, frame, roof" standing for six rows is CORRECT, not a finding.
- Different wording for the same thing is NOT a finding. Only report a genuine gap or a genuine conflict in a stated value or material.
- Cite the schedule row numbers that bear on each finding. A finding citing no rows is only valid when the point is that NOTHING covers it.
- Echo the source line verbatim in "source".
- Prefer silence to a weak finding. A false alarm on a live deal costs more than a missed nuance. If in doubt, say nothing.
- Return an empty findings array when the three lists agree.
</hard_rules>`;

export async function checkOfferConsistency(
  input: ConsistencyCheckInput,
): Promise<ConsistencyCheckResult> {
  if (input.promised.length === 0) {
    return { ok: true, findings: [] };
  }

  const promised = input.promised
    .map((spec, index) => `${index + 1}. ${spec.trim()}`)
    .join("\n");
  const priced = input.pricedItems.map((item) => `- ${item.trim()}`).join("\n");
  const sold = input.sold.map((line) => `- ${line.trim()}`).join("\n");

  try {
    const { output } = await generateText({
      model: gateway("google/gemini-2.5-flash"),
      // Judgement, not prose: keep it as close to deterministic as the model allows.
      temperature: 0,
      system: SYSTEM_PROMPT,
      output: Output.object({ schema: consistencySchema }),
      prompt: `Audit this offer.\n\n<priced>\n${priced || "(nothing priced)"}\n</priced>\n\n<promised>\n${promised}\n</promised>\n\n<sold>\n${sold || "(nothing sold)"}\n</sold>`,
    });

    const parsed = consistencySchema.parse(output);
    const maxRow = input.promised.length;
    const findings = parsed.findings
      .map((finding) => ({
        kind: finding.kind,
        source: finding.source.trim(),
        detail: finding.detail.trim(),
        // Drop cited rows that do not exist rather than render a broken link.
        scheduleRows: finding.scheduleRows.filter((row) => row <= maxRow),
      }))
      .filter((finding) => finding.source.length > 0 && finding.detail.length > 0);

    return { ok: true, findings };
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
