import { z } from "zod";
import {
  agentResultEnvelopeSchema,
  type AgentResultEnvelope,
} from "@/agent/lib/result-contracts";

/**
 * What a specialist's final answer is validated against inside eve.
 *
 * The canonical envelope requires `version: 1`, and on a large result the model
 * kept dropping it or writing `"1"`: eve rejected the final answer 1–3 times in
 * 6 of 7 staging runs, a ~50k-token step each, and once the model escaped by
 * submitting a `"test"` envelope that parsed. The specialist no longer has to
 * get it right. `version` stays accepted (eve lowers this schema with
 * `additionalProperties: false`, so dropping the key outright would reject a
 * model that still writes it) and `delegate` stamps `version: 1` before
 * validating against the canonical schema. Tool outputs stay strict.
 */
export const specialistOutputSchema = agentResultEnvelopeSchema.extend({
  version: z
    .unknown()
    .optional()
    .describe("Optional. The server sets it; you may leave it out."),
});

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
 * Stamp the version and decide whether a specialist's answer can be shown.
 *
 * Unusable: not an envelope, missing fields, an empty summary, or a
 * placeholder title or summary. A real "nothing matched" answer, with empty
 * data and no record reference, is usable: it says what was searched.
 */
export function judgeSpecialistResult(output: unknown): SpecialistResultVerdict {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return { usable: false, reason: "it returned no result envelope" };
  }
  const parsed = agentResultEnvelopeSchema.safeParse({
    ...(output as Record<string, unknown>),
    version: 1,
  });
  if (!parsed.success) {
    return { usable: false, reason: "its result was missing required fields" };
  }
  const envelope = parsed.data;
  if (!envelope.summary) {
    return { usable: false, reason: "its result had an empty summary" };
  }
  if (isPlaceholder(envelope.title) || isPlaceholder(envelope.summary)) {
    return { usable: false, reason: "its result was a placeholder" };
  }
  return { usable: true, envelope };
}
