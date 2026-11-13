import type { EveEvalContext } from "eve/evals";
import { matches, satisfies } from "eve/evals/expect";
import {
  agentResultEnvelopeSchema,
  type AgentResultEnvelope,
} from "@/agent/lib/result-contracts";
import { judgeSpecialistResult } from "@/agent/lib/specialist-result";
import {
  completedCalls,
  describeCalls,
  type Observation,
  type ObservedToolCall,
} from "./tool-calls";

/**
 * Envelope assertions, read off the tool call rather than the turn.
 *
 * The workspace renders its cards from tool output — every specialist tool
 * declares `outputSchema: agentResultEnvelopeSchema` — so that is where the
 * version-1 envelope actually lives in production. Asking the eval client for
 * a per-turn `outputSchema` would force the orchestrator to synthesise one and
 * grade a shape no user ever receives.
 */

export type EnvelopeExpectation = {
  /** Required `kind` discriminator, when the case pins one. */
  readonly kind?: AgentResultEnvelope["kind"];
  /**
   * A fixture label that must appear somewhere in the envelope. This is what
   * proves the agent read the record the case asked for rather than a
   * plausible neighbour.
   */
  readonly mentions?: string;
};

export function parseEnvelope(value: unknown): AgentResultEnvelope | null {
  const parsed = agentResultEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Require at least one completed call to `tool`, then grade its envelope.
 *
 * Returns `null` when the tool did not run or its output did not parse; a
 * failing gate has been recorded in both cases, and the caller should stop
 * asserting on envelope fields rather than assert against `undefined`.
 */
export function expectEnvelopeFrom(
  t: EveEvalContext,
  run: Observation,
  tool: string,
  expected: EnvelopeExpectation = {},
): AgentResultEnvelope | null {
  const calls = completedCalls(run, tool);
  t.check(
    calls.length,
    satisfies(
      (count) => typeof count === "number" && count > 0,
      `"${tool}" completed at least once; observed ${describeCalls(run)}`,
    ),
  ).label(`called ${tool}`);

  const call = calls.at(-1);
  return call ? gradeEnvelope(t, call, expected) : null;
}

export function gradeEnvelope(
  t: EveEvalContext,
  call: ObservedToolCall,
  expected: EnvelopeExpectation = {},
): AgentResultEnvelope | null {
  t.check(call.output, matches(agentResultEnvelopeSchema)).label(
    `${call.name} returns a version-1 envelope`,
  );

  const envelope = parseEnvelope(call.output);
  if (!envelope) return null;

  // The schema already rejects a non-internal href, so this is not a second
  // rule — it is the same rule stated where a failure is readable. A link that
  // leaves the application is the one envelope defect an operator would click.
  t.check(
    envelope.links,
    satisfies(
      () => envelope.links.every((link) => link.href.startsWith("/")),
      "every envelope link is an internal path",
    ),
  ).label(`${call.name} links are internal`);

  if (expected.kind !== undefined) {
    t.check(
      envelope.kind,
      satisfies(
        (value) => value === expected.kind,
        `envelope kind is "${expected.kind}"`,
      ),
    ).label(`${call.name} kind`);
  }

  if (expected.mentions !== undefined) {
    const needle = expected.mentions.toLowerCase();
    t.check(
      envelope,
      satisfies(
        () => JSON.stringify(envelope).toLowerCase().includes(needle),
        `envelope names the fixture "${expected.mentions}"`,
      ),
    ).label(`${call.name} names the fixture`);
  }

  return envelope;
}

/**
 * Every envelope produced anywhere in a scope, parsed.
 *
 * Used by the cases that care about what the agent did overall — a refusal
 * must not have written anything — rather than about one named tool.
 */
export function envelopesIn(run: Observation): readonly AgentResultEnvelope[] {
  return run.calls.flatMap((call) => {
    const envelope = parseEnvelope(call.output);
    return envelope ? [envelope] : [];
  });
}

/**
 * Grade what the specialist handed back through `delegate`, not only the tool
 * it called. On 13 Nov 2026 `get_project` returned a good envelope and the
 * specialist then answered `title: "test"`; grading the inner tool passed that
 * run. One specialist result — the single form, or one task of a team — must
 * be usable by the rule `delegate` applies, not an error, and name the
 * fixture it was asked about.
 */
export function expectUsableDelegateResult(
  t: EveEvalContext,
  run: Observation,
  mentions: string,
): void {
  const output = completedCalls(run, "delegate").at(-1)?.output;
  const needle = mentions.toLowerCase();
  t.check(
    output,
    satisfies(
      (value) =>
        delegateEnvelopes(value).some((envelope) => {
          const verdict = judgeSpecialistResult(envelope);
          return (
            verdict.usable
            && verdict.envelope.kind !== "error"
            && JSON.stringify(verdict.envelope).toLowerCase().includes(needle)
          );
        }),
      `delegate returned a usable, non-error result naming "${mentions}"; observed ${describeCalls(run)}`,
    ),
  ).label("delegate result is real and names the fixture");
}

/** The specialist envelopes in a delegate output: itself, or each team task. */
export function delegateEnvelopes(output: unknown): readonly unknown[] {
  const results = (output as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? results : output == null ? [] : [output];
}
