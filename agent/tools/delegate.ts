import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import {
  SPECIALISTS,
  DELEGATE_TARGETS,
  type SpecialistName,
} from "@/agent/lib/specialists";
import {
  MAX_TEAM_TASKS,
  briefFor,
  planWaves,
  specialistFinding,
  taskNotRun,
  type TeamTask,
} from "@/agent/lib/team-dispatch";

/**
 * The orchestrator's only way to reach a specialist, and it waits.
 *
 * eve lowers every declared subagent into a *background* tool: the call returns
 * a `{ status: "working" }` receipt, the parent's turn ends, and a task
 * notification wakes it later. Both of our surfaces break on that:
 *
 * - An MCP `agent_start` runs one task-mode session. A task-mode turn that ends
 *   with pending background work finishes the session, and finishing a session
 *   terminates its children. The client read `completed` with "I'll share the
 *   results once the task completes" and the specialist was killed — a
 *   reported success with nothing behind it.
 * - The /agent workspace detached at the parked turn, never saw the specialist
 *   finish, and on reload rendered the completion as a user message containing
 *   the raw result envelope.
 *
 * A blocking workflow tool keeps the parent turn open until the specialists
 * settle. The specialists set `tool: false`, so this is the only route.
 * Approvals raised inside a specialist still surface on the parent session (and
 * as `input_required` over MCP), and a specialist failure comes back as a
 * failed tool result the orchestrator has to report.
 *
 * Blocking does not mean one at a time. `tasks` sends several specialists out
 * together and waits once for all of them (agent/lib/team-dispatch.ts): a
 * question that spans a lead, its offer and its project is one round trip, not
 * three. A task with `after` waits for those teammates and starts from what
 * they found.
 */

const specialistSchema = z.enum(DELEGATE_TARGETS);

const inputSchema = z
  .object({
    goal: z
      .string()
      .trim()
      .max(2_000)
      .optional()
      .describe(
        "What the person wants, in a sentence or two. Every task sees it.",
      ),
    sharedContext: z
      .string()
      .trim()
      .max(8_000)
      .optional()
      .describe(
        "Facts every task should start from: records already identified (with their ids from recall_crm_context), names, dates, amounts.",
      ),
    specialist: specialistSchema
      .optional()
      .describe(
        "Single-task form: the specialist. Use `tasks` for more than one.",
      ),
    request: z
      .string()
      .trim()
      .min(1)
      .max(16_000)
      .optional()
      .describe("Single-task form: the self-contained request."),
    tasks: z
      .array(
        z.object({
          id: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9_-]{1,32}$/)
            .describe("Short handle, e.g. lead or offer."),
          specialist: specialistSchema,
          request: z.string().trim().min(1).max(16_000),
          after: z
            .array(z.string())
            .max(MAX_TEAM_TASKS)
            .optional()
            .describe(
              "Ids of tasks whose findings this one needs. Omit to start immediately.",
            ),
        }),
      )
      .min(1)
      .max(MAX_TEAM_TASKS)
      .optional()
      .describe(
        "Several specialist tasks run as a team: independent ones in parallel.",
      ),
  })
  .refine(
    (input) =>
      input.tasks !== undefined
        ? input.specialist === undefined && input.request === undefined
        : input.specialist !== undefined && input.request !== undefined,
    { message: "Send either specialist + request, or tasks — not both." },
  );

export default defineWorkflowTool({
  description: [
    "Hand work to operations specialists and wait for their typed results.",
    "Specialists do not see this conversation: put every name, id, date and constraint they need in the request, goal or sharedContext.",
    "For one specialist send `specialist` + `request`. For work that spans areas send `tasks`: tasks without `after` run in parallel, and a task with `after` waits for those tasks and receives their findings (record ids included), so it does not search again.",
    "Parallel tasks are for reads and for independent changes the person has already asked for; a change that depends on another result goes in a later task with `after`.",
    "A change that comes back cancelled or declined at approval is the person's answer: never delegate it again.",
    "Specialists:",
    ...DELEGATE_TARGETS.map((name) => `- ${name}: ${SPECIALISTS[name]}`),
  ].join("\n"),
  inputSchema,
  async execute(input, ctx) {
    "use workflow";
    const single = input.tasks === undefined;
    const tasks: TeamTask[] = single
      ? [
          {
            id: "task",
            request: input.request as string,
            specialist: input.specialist as SpecialistName,
          },
        ]
      : (input.tasks as TeamTask[]);

    let waves: TeamTask[][];
    try {
      waves = planWaves(tasks);
    } catch (error) {
      return taskNotRun(
        tasks[0]!.specialist,
        "Tasks could not be planned",
        `${error instanceof Error ? error.message : "Invalid task plan."} Nothing was looked up or changed.`,
      );
    }

    const findings: Record<string, unknown> = {};
    const failed = new Set<string>();
    for (const wave of waves) {
      const settled = await Promise.all(
        wave.map(async (task) => {
          // A specialist is omitted for a session that is not a signed-in
          // user, or while EVE_OPERATIONS_SPECIALISTS_ENABLED is off. Say so
          // plainly rather than letting eve fail the call generically.
          if (!Object.hasOwn(ctx.agents, task.specialist)) {
            failed.add(task.id);
            return [task.id, unavailable(task.specialist)] as const;
          }
          const blockedBy = (task.after ?? []).filter((id) => failed.has(id));
          if (blockedBy.length) {
            failed.add(task.id);
            return [
              task.id,
              taskNotRun(
                task.specialist,
                "Task skipped",
                `Not started because ${blockedBy.join(", ")} did not finish. Nothing was looked up or changed for this task.`,
              ),
            ] as const;
          }
          const message = briefFor(task, {
            findings,
            goal: input.goal,
            sharedContext: input.sharedContext,
            teamSize: tasks.length,
          });
          try {
            const output = await ctx.agent(task.specialist, { message });
            // A specialist that answered with an error envelope did not do
            // its task: its dependents must not start from it as if it had.
            if (!single && isErrorEnvelope(output)) failed.add(task.id);
            return [
              task.id,
              specialistFinding(task.specialist, output),
            ] as const;
          } catch (error) {
            // One task alone keeps failing the tool call, so the orchestrator
            // cannot mistake it for an answer. In a team, the others' results
            // are real and are returned beside a plain failure for this one.
            if (single) throw error;
            failed.add(task.id);
            return [
              task.id,
              taskNotRun(
                task.specialist,
                "Specialist failed",
                `The ${task.specialist} specialist failed (${error instanceof Error ? error.message : "unknown error"}). Do not assume any part of this task was done.`,
              ),
            ] as const;
          }
        }),
      );
      for (const [id, result] of settled) findings[id] = result;
    }

    if (single) return findings.task;
    return {
      results: tasks.map((task) => ({
        task: task.id,
        ...asRecord(findings[task.id]),
      })),
      summary: `${tasks.length - failed.size} of ${tasks.length} tasks finished${failed.size ? `; not finished: ${[...failed].join(", ")}` : ""}.`,
    };
  },
});

function isErrorEnvelope(value: unknown): boolean {
  return (
    value !== null
    && typeof value === "object"
    && (value as { kind?: unknown }).kind === "error"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { output: value };
}

function unavailable(specialist: SpecialistName) {
  return taskNotRun(
    specialist,
    "Specialist unavailable",
    `The ${specialist} specialist is not available in this session, so nothing was looked up or changed.`,
  );
}
