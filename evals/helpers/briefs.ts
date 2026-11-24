import type { EveEvalContext } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { assertNoMutation } from "./boundaries";
import { delegateEnvelopes } from "./envelope";
import { completedCalls, describeCalls, observe } from "./tool-calls";

/**
 * The twice-daily brief, graded on what made it come back incomplete (#618).
 *
 * In production, 15 specialist results were `kind: "error"`, most from the
 * briefs: "Morning brief incomplete", "Active project list unavailable",
 * "Offer briefing evidence unavailable". There was no office-wide read for
 * tasks due, meetings, milestones or offers, so a specialist walked records
 * one at a time (389 `get_project` and 279 `list_lead_tasks` calls in 14
 * days) until it ran out of steps.
 *
 * A brief passes when no specialist reports an error, nothing is written, the
 * office-wide reads are used, and the per-record reads stay few.
 */
const OFFICE_WIDE_READS = [
  "list_lead_tasks_due",
  "list_lead_meetings",
  "list_overdue_lead_tasks",
  "list_milestones_due",
  "list_offers",
] as const;

/** Per-record reads a brief should not need more than a handful of. */
const PER_RECORD_READS = ["get_project", "list_lead_tasks", "get_compliance"];
const MAX_PER_RECORD_READS = 4;

export async function expectCompleteBrief(
  t: EveEvalContext,
  prompt: string,
): Promise<void> {
  const turn = await t.send(prompt);
  t.succeeded();
  t.noFailedActions();
  const run = await observe(t, turn.session);
  assertNoMutation(t, run);

  const results = completedCalls(run, "delegate").flatMap((call) =>
    delegateEnvelopes(call.output),
  );
  const errors = results.filter(
    (result) =>
      typeof result === "object"
      && result !== null
      && (result as { kind?: unknown }).kind === "error",
  );
  t.check(
    errors,
    satisfies(
      () => errors.length === 0,
      `no specialist returned kind "error"; got ${JSON.stringify(errors.map((e) => (e as { title?: unknown }).title))}`,
    ),
  ).label("every specialist result is complete");

  const officeWide = run.calls.filter(
    (call) =>
      call.status === "completed"
      && (OFFICE_WIDE_READS as readonly string[]).includes(call.name),
  );
  t.check(
    officeWide,
    satisfies(
      () => officeWide.length > 0,
      `the brief used an office-wide read; observed ${describeCalls(run)}`,
    ),
  ).label("office-wide reads are used");

  const perRecord = run.calls.filter((call) =>
    PER_RECORD_READS.includes(call.name),
  );
  t.check(
    perRecord,
    satisfies(
      () => perRecord.length <= MAX_PER_RECORD_READS,
      `at most ${MAX_PER_RECORD_READS} per-record reads; observed ${describeCalls(run)}`,
    ),
  ).label("records are not walked one by one");
}
