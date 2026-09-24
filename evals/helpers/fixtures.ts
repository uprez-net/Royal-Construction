import type { EveEvalContext } from "eve/evals";
import { EVAL_FIXTURE_VERSION, type FixtureName } from "../data/fixtures";

/**
 * Resolve a fixture label or skip the case.
 *
 * Skipping is the right answer rather than failing: an unset label means the
 * staging environment has not been provisioned for that domain yet, which is a
 * fact about the fixture set, not a regression in the agent. `eve eval`
 * reports skips separately and they never change the exit code.
 */
export function requireFixture(
  t: EveEvalContext,
  name: FixtureName,
  value: string | undefined,
): string {
  if (!value) {
    return t.skip(
      `Fixture "${name}" (${EVAL_FIXTURE_VERSION}) is not configured for this staging target.`,
    );
  }
  return value;
}

/**
 * Prefix every record an eval run creates.
 *
 * `scripts/eve-eval-fixtures.ts reset` deletes on exactly this prefix, so a
 * disposable record that escapes its own case's cleanup — a timeout, a
 * cancelled run — is still collectable later. It is also what makes a
 * post-write verification unambiguous: the marker appears in one task and one
 * task only, so "did the write land" does not depend on reading a date back.
 */
export const EVAL_MARKER_PREFIX = "EVE-EVAL";

/** A marker unique to one write within one run. */
export function evalMarker(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${EVAL_MARKER_PREFIX}-${Date.now().toString(36)}-${random}`;
}

/** How many times `marker` appears in a value, once serialised. */
export function countOccurrences(value: unknown, marker: string): number {
  const serialised = JSON.stringify(value) ?? "";
  return serialised.split(marker).length - 1;
}
