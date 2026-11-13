import {
  normalizeSpecialistResult,
  specialistResultSchema,
  type AgentResultEnvelope,
} from "@/agent/lib/result-contracts";

/**
 * What a specialist's final answer is validated against inside eve.
 *
 * The canonical envelope requires `version: 1`, and on a large result the model
 * kept dropping it or writing `"1"`: eve rejected the final answer 1–3 times in
 * 6 of 7 staging runs, a ~50k-token step each, and once the model escaped by
 * submitting a `"test"` envelope that parsed. The length caps and closed key
 * sets did the same to long project answers (#429). So the specialist answers
 * against the loose `specialistResultSchema` — `version` optional, no caps,
 * extra keys allowed, `kind` free text — and `delegate` normalises the answer
 * into the canonical envelope (stamping `version: 1`) before judging it here.
 * Tool outputs stay strict.
 */
export const specialistOutputSchema = specialistResultSchema;

/**
 * Titles and summaries that say nothing. A specialist that cannot produce its
 * real answer must fail, not hand back one of these as a success.
 */
const PLACEHOLDERS = new Set([
  "test",
  "testing",
  "todo",
  "tbd",
  "placeholder",
  "n/a",
  "na",
  "null",
  "undefined",
  "ok",
  "x",
  "...",
  "-",
  "lorem ipsum",
]);

function isPlaceholder(text: string): boolean {
  return PLACEHOLDERS.has(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!\s]+$/, ""),
  );
}

export type SpecialistResultVerdict =
  | { readonly usable: true; readonly envelope: AgentResultEnvelope }
  | { readonly usable: false; readonly reason: string };

/**
 * Normalise a specialist's answer and decide whether it can be shown.
 *
 * Unusable: not an envelope, no title or summary, an empty summary, or a
 * placeholder title or summary. A real "nothing matched" answer, with empty
 * data and no record reference, is usable: it says what was searched.
 */
export function judgeSpecialistResult(output: unknown): SpecialistResultVerdict {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return { usable: false, reason: "it returned no result envelope" };
  }
  const answer = output as Record<string, unknown>;
  if (typeof answer.title !== "string" || typeof answer.summary !== "string") {
    return { usable: false, reason: "its result was missing required fields" };
  }
  // Long fields are shortened and stray keys folded into `data`, rather than
  // the whole answer being refused for them (result-contracts.ts).
  const envelope = normalizeSpecialistResult(answer);
  // A change the person cancelled is a real answer whatever its wording;
  // team-dispatch gives it fixed text.
  if (envelope.data.cancelled === true) return { usable: true, envelope };
  if (!envelope.summary) {
    return { usable: false, reason: "its result had an empty summary" };
  }
  if (isPlaceholder(envelope.title) || isPlaceholder(envelope.summary)) {
    return { usable: false, reason: "its result was a placeholder" };
  }
  return { usable: true, envelope };
}
