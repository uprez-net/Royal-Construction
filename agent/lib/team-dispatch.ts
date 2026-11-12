import type { SpecialistName } from "@/agent/lib/specialists";

// How one `delegate` call runs several specialists as a team.
//
// Pure, and free of anything Node-only, because it runs inside the delegate
// tool's "use workflow" body, which is replayed and must stay deterministic.
//
// The shape: tasks with no `after` start together; a task with `after` waits
// for those teammates and is handed what they found. That is the whole of the
// "team": a shared goal and shared context in every brief, and findings passed
// forward to the tasks that depend on them — so the offer specialist starts
// from the lead the lead specialist already resolved, instead of searching for
// it again, and independent lookups stop queueing behind each other.

export type TeamTask = {
  readonly id: string;
  readonly specialist: SpecialistName;
  readonly request: string;
  readonly after?: readonly string[];
};

export const MAX_TEAM_TASKS = 6;
const MAX_FINDING_CHARS = 3_000;
const MAX_DATA_CHARS = 1_500;

/**
 * Group tasks into waves that can run together, in dependency order.
 *
 * Throws on an unknown or self dependency and on a cycle: the schema cannot
 * express those, and running a task without the findings it asked for would
 * be the silent kind of wrong.
 */
export function planWaves(tasks: readonly TeamTask[]): TeamTask[][] {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) throw new Error("Each task needs its own id.");
  for (const task of tasks) {
    for (const dependency of task.after ?? []) {
      if (dependency === task.id)
        throw new Error(`Task ${task.id} cannot wait for itself.`);
      if (!ids.has(dependency))
        throw new Error(
          `Task ${task.id} waits for unknown task ${dependency}.`,
        );
    }
  }
  const done = new Set<string>();
  const waves: TeamTask[][] = [];
  let remaining = [...tasks];
  while (remaining.length) {
    const ready = remaining.filter((task) =>
      (task.after ?? []).every((dependency) => done.has(dependency)),
    );
    if (!ready.length)
      throw new Error("The tasks wait for each other in a circle.");
    waves.push(ready);
    for (const task of ready) done.add(task.id);
    remaining = remaining.filter((task) => !done.has(task.id));
  }
  return waves;
}

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** What a teammate found, in the few lines a dependent task needs. */
export function describeFinding(taskId: string, result: unknown): string {
  if (!result || typeof result !== "object") {
    return `- ${taskId}: ${clip(String(result), MAX_FINDING_CHARS)}`;
  }
  const envelope = result as {
    specialist?: string;
    kind?: string;
    title?: string;
    summary?: string;
    entityRef?: { type?: string; id?: string; display?: { label?: string } };
    data?: unknown;
    warnings?: unknown;
    /** A specialist that answered in plain text instead of an envelope. */
    output?: unknown;
  };
  const ref = envelope.entityRef;
  const reply =
    envelope.output === undefined || envelope.output === null
      ? null
      : typeof envelope.output === "string"
        ? envelope.output
        : JSON.stringify(envelope.output);
  const lines = [
    `- ${taskId} (${envelope.specialist ?? "specialist"}, ${envelope.kind ?? "result"}): ${envelope.title ?? ""}`,
    envelope.summary ? `  ${envelope.summary}` : null,
    reply ? `  Reply: ${clip(reply, MAX_DATA_CHARS)}` : null,
    ref?.type && ref.id
      ? `  Record: ${ref.display?.label ?? ref.type} (${ref.type}Id=${ref.id})`
      : null,
    envelope.data
    && typeof envelope.data === "object"
    && Object.keys(envelope.data).length
      ? `  Data: ${clip(JSON.stringify(envelope.data), MAX_DATA_CHARS)}`
      : null,
    Array.isArray(envelope.warnings) && envelope.warnings.length
      ? `  Warnings: ${envelope.warnings.join("; ")}`
      : null,
  ];
  return clip(lines.filter(Boolean).join("\n"), MAX_FINDING_CHARS);
}

/**
 * The message one specialist receives.
 *
 * A lone task with no goal and no shared context is sent exactly as written:
 * the brief exists to share something, and with nothing to share it would
 * only cost the specialist tokens.
 */
export function briefFor(
  task: TeamTask,
  team: {
    goal?: string;
    sharedContext?: string;
    teamSize: number;
    findings: Readonly<Record<string, unknown>>;
  },
): string {
  const findings = (task.after ?? [])
    .filter((id) => Object.hasOwn(team.findings, id))
    .map((id) => describeFinding(id, team.findings[id]));
  if (
    !team.goal
    && !team.sharedContext
    && !findings.length
    && team.teamSize === 1
  ) {
    return task.request;
  }
  return [
    team.teamSize > 1
      ? `You are one of ${team.teamSize} specialists working on this request at the same time. Do only your task; teammates own the rest.`
      : null,
    team.goal ? `Goal: ${team.goal}` : null,
    team.sharedContext
      ? `Known context (office snapshot; confirm live values with your tools before acting):\n${team.sharedContext}`
      : null,
    findings.length
      ? `What your teammates found (use their record ids instead of searching again):\n${findings.join("\n")}`
      : null,
    `Your task: ${task.request}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A task that could not run, said plainly so nothing reads as done. */
export function taskNotRun(
  specialist: SpecialistName,
  title: string,
  summary: string,
) {
  return {
    kind: "error",
    specialist,
    summary,
    title,
    version: 1,
  };
}
