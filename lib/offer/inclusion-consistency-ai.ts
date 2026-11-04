import {
  generateText,
  Output,
  NoObjectGeneratedError,
  TypeValidationError,
  NoOutputGeneratedError,
} from "ai";
import { z } from "zod";
import { gateway, TEXT_MODEL_ID } from "@/lib/model";

// Consistency check across the three lists on an offer.
//
//   ESTIMATED — cost schedule (Step 2). What has money against it.
//   SCHEDULE  — the inclusion & exclusion schedule. What the contract commits to.
//   OFFER     — "This price includes" (Step 5, top). What the client is pitched.
//
// The rule: estimated → schedule → offer. Never offer what is not in the
// schedule; never schedule what was never estimated.
//
// The model ONLY JUDGES. It never writes a spec, a highlight, or a category.
// Everything it returns is a finding for a human to act on, because a sentence
// it wrote would be a contractual obligation Royal has to build.

const findingSchema = z.object({
  kind: z.enum([
    "estimated-not-scheduled",
    "offer-not-scheduled",
    "offer-contradicts-exclusion",
  ]),
  // The estimated line or offer line the finding is about, echoed verbatim.
  source: z.string(),
  // Plain-language statement of what is wrong.
  detail: z.string(),
  // 1-based schedule rows that bear on it. May be empty.
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
  // Offer/tender wording of every INCLUDED, ESTIMATED cost line.
  readonly estimated: readonly string[];
  // The inclusions schedule, in order. Index + 1 is the printed row number.
  readonly scheduled: readonly string[];
  // The exclusions that print on the document. Offering one of these back to
  // the client is the worst of the three failures, so they go in too.
  readonly excluded: readonly string[];
  // The selling lines beside the price.
  readonly offered: readonly string[];
};

export type ConsistencyCheckResult =
  | { ok: true; findings: readonly ConsistencyFinding[] }
  | { ok: false; message: string };

const SYSTEM_PROMPT = `You audit an Australian fixed-price residential building offer for internal consistency.

You are given four lists:
- ESTIMATED: cost items the builder has money against.
- SCHEDULE: the contractual Inclusions Schedule the client signs.
- EXCLUDED: what the document explicitly says is NOT included.
- OFFER: the short selling lines printed beside the price.

Report only these problems:
- "estimated-not-scheduled": something in ESTIMATED the schedule never commits to. The builder has costed work the contract does not mention.
- "offer-not-scheduled": something in OFFER the schedule does not support. The client is being offered something the contract does not commit to.
- "offer-contradicts-exclusion": something in OFFER that EXCLUDED explicitly rules out. This is the most serious: the same document both promises and refuses it.

<hard_rules>
- JUDGE ONLY. Never rewrite, never suggest replacement wording, never author a specification. Your output is findings for a human.
- One OFFER line routinely covers SEVERAL schedule rows. "All structural works — slab, frame, roof" standing for six rows is CORRECT, not a finding.
- Different wording for the same thing is NOT a finding. Only report a genuine gap or a genuine conflict in a stated value or material.
- Cite the schedule row numbers that bear on each finding. A finding citing no rows is only valid when the point is that NOTHING covers it.
- Echo the source line verbatim in "source".
- Prefer silence to a weak finding. A false alarm on a live deal costs more than a missed nuance. If in doubt, say nothing.
- Return an empty findings array when the lists agree.
</hard_rules>`;

export async function checkOfferConsistency(
  input: ConsistencyCheckInput,
): Promise<ConsistencyCheckResult> {
  if (input.scheduled.length === 0) {
    return { ok: true, findings: [] };
  }

  const scheduled = input.scheduled
    .map((spec, index) => `${index + 1}. ${spec.trim()}`)
    .join("\n");
  const estimated = input.estimated
    .map((item) => `- ${item.trim()}`)
    .join("\n");
  const excluded = input.excluded.map((item) => `- ${item.trim()}`).join("\n");
  const offered = input.offered.map((line) => `- ${line.trim()}`).join("\n");

  try {
    const { output } = await generateText({
      model: gateway(TEXT_MODEL_ID),
      system: SYSTEM_PROMPT,
      output: Output.object({ schema: consistencySchema }),
      prompt: `Audit this offer.\n\n<estimated>\n${estimated || "(nothing estimated)"}\n</estimated>\n\n<schedule>\n${scheduled}\n</schedule>\n\n<excluded>\n${excluded || "(nothing excluded)"}\n</excluded>\n\n<offer>\n${offered || "(nothing offered)"}\n</offer>`,
    });

    const parsed = consistencySchema.parse(output);
    const maxRow = input.scheduled.length;
    const findings = parsed.findings
      .map((finding) => ({
        kind: finding.kind,
        source: finding.source.trim(),
        detail: finding.detail.trim(),
        // Drop cited rows that do not exist rather than render a broken link.
        scheduleRows: finding.scheduleRows.filter((row) => row <= maxRow),
      }))
      .filter(
        (finding) => finding.source.length > 0 && finding.detail.length > 0,
      );

    return { ok: true, findings };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error)
      || TypeValidationError.isInstance(error)
      || NoOutputGeneratedError.isInstance(error)
    ) {
      return { ok: false, message: (error as Error).message };
    }
    throw error;
  }
}

// ─── Drafting the OFFER list from the SCHEDULE ───

const highlightsSchema = z.object({
  highlights: z.array(z.string()),
});

export type HighlightDraftResult =
  | { ok: true; highlights: readonly string[] }
  | { ok: false; message: string };

const DRAFT_SYSTEM_PROMPT = `You write the "This price includes" list for an Australian fixed-price residential building offer.

You are given the full contractual Inclusions Schedule. Write 10-14 short selling lines summarising it for the page beside the price.

<hard_rules>
- Every line must be supported by the schedule. NEVER promise anything the schedule does not contain — an invented inclusion becomes a contractual obligation the builder must meet.
- Preserve stated values EXACTLY. If the schedule says 40mm, write 40mm, never 60mm. Same for kW, zones, standards (AS3740), sizes and brands.
- GROUP related rows. One line standing for several rows is wanted: "All structural works — slab, frame, roof" covering the slab, frame, roof and truss rows is correct. One line per row is wrong.
- Lead with the concrete thing the schedule names: material, size, brand, quantity.
- Prefer the notable over the obvious. A buyer chooses a builder for the stone benchtops and the full-facade render, not for the waterproofing compliance or the wall batts. Necessary-but-unremarkable items belong in the schedule, not on the price page.
- Maximum 8 words per line. Australian English. No trailing full stop. No marketing adjectives the schedule does not itself use.
</hard_rules>`;

// Draft the selling list from the contractual schedule. This SHORTENS text the
// human already committed to — it never authors a specification, which is the
// line that separates it from writing contract wording.
export async function draftInclusionHighlights(
  scheduled: readonly string[],
): Promise<HighlightDraftResult> {
  const specs = scheduled
    .map((spec) => spec.trim())
    .filter((spec) => spec.length > 0);
  if (specs.length === 0) {
    return { ok: true, highlights: [] };
  }

  try {
    const { output } = await generateText({
      model: gateway(TEXT_MODEL_ID),
      system: DRAFT_SYSTEM_PROMPT,
      output: Output.object({ schema: highlightsSchema }),
      prompt: `Write the selling list for this schedule. Shorten and group only — never add a detail the schedule does not state.\n\n<schedule>\n${specs.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n</schedule>`,
    });

    const parsed = highlightsSchema.parse(output);
    const highlights = parsed.highlights
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // A runaway response must not replace a curated list with 60 lines.
      .slice(0, 20);

    return { ok: true, highlights };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error)
      || TypeValidationError.isInstance(error)
      || NoOutputGeneratedError.isInstance(error)
    ) {
      return { ok: false, message: (error as Error).message };
    }
    throw error;
  }
}
