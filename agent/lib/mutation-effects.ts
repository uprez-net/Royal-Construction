import {
  agentEffectsSecret,
  agentEffectsUrl,
} from "@/lib/cache/agent-effects-channel";

// After an agent write commits, tell the app which records changed so their
// screens stop showing the old version (app/api/agent/effects).
//
// Called from exactly one place, runAuditedAgentOperation, which every agent
// write already passes through. No tool names its own cache tags: the refs are
// read off what the tool already reports — its audit target, its input
// summary and its result envelope — and the app owns the tag table. Adding a
// tool adds nothing here; adding a cached screen adds one line to
// lib/cache/agent-effects.ts.

export type MutationRef = { type: string; id: string };

/** Fields whose value names a record, wherever a tool happens to put them. */
const ID_FIELDS: Readonly<Record<string, string>> = {
  leadId: "lead",
  milestoneId: "milestone",
  offerId: "offer",
  projectId: "project",
  scheduleId: "tradieSchedule",
  taskId: "leadTask",
  tradieId: "tradie",
};
const ID_LIST_FIELDS: Readonly<Record<string, string>> = {
  affectedProjectIds: "project",
  projectIds: "project",
};
const MAX_REFS = 50;

function asId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  if (typeof value === "string" && /^[\w-]{1,100}$/.test(value)) return value;
  return null;
}

/** Deep enough for `data.schedule.projectId`, shallow enough to stay cheap. */
const MAX_DEPTH = 3;

/**
 * Id fields at any level of a reported object: a tool that nests the record
 * it changed (`data: { schedule: { projectId } }`) still expires its screens.
 */
function collectFrom(
  record: unknown,
  add: (type: string, id: unknown) => void,
  depth = 0,
) {
  if (!record || typeof record !== "object" || depth > MAX_DEPTH) return;
  if (Array.isArray(record)) {
    for (const item of record) collectFrom(item, add, depth + 1);
    return;
  }
  for (const [field, value] of Object.entries(record)) {
    const type = ID_FIELDS[field];
    if (type) add(type, value);
    const listType = ID_LIST_FIELDS[field];
    if (listType && Array.isArray(value)) {
      for (const item of value) add(listType, item);
    } else if (value && typeof value === "object") {
      collectFrom(value, add, depth + 1);
    }
  }
}

/**
 * Every record a completed write names. Pure, so the extraction is tested
 * without a runtime.
 */
export function mutationRefs(input: {
  targetType?: string;
  targetId?: string;
  inputSummary?: unknown;
  output?: unknown;
}): MutationRef[] {
  const refs = new Map<string, MutationRef>();
  const add = (type: string, value: unknown) => {
    const id = asId(value);
    if (!id || refs.size >= MAX_REFS) return;
    refs.set(`${type}:${id}`, { id, type });
  };

  if (input.targetType && input.targetId) add(input.targetType, input.targetId);
  collectFrom(input.inputSummary, add);

  const output = input.output as
    | { entityRef?: { type?: unknown; id?: unknown }; data?: unknown }
    | null
    | undefined;
  if (output && typeof output === "object") {
    if (typeof output.entityRef?.type === "string")
      add(output.entityRef.type, output.entityRef.id);
    collectFrom(output.data, add);
  }
  return [...refs.values()];
}

/**
 * Post the refs to the app. Never throws and never takes long: the write has
 * already committed, and a stale screen is not worth failing the operator's
 * request over. A failure is logged with the refs so it can be traced.
 */
export async function publishMutationEffects(
  refs: readonly MutationRef[],
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!refs.length) return false;
  const url = agentEffectsUrl();
  const secret = agentEffectsSecret();
  if (!url || !secret) {
    console.warn(
      "[agent-effects] not configured (NEXT_PUBLIC_APP_URL and CRON_SECRET or AGENT_EFFECTS_SECRET); screens will refresh on their own cache lifetimes",
    );
    return false;
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  try {
    const response = await fetchImpl(url, {
      body: JSON.stringify({ refs }),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      console.error(
        "[agent-effects] app refused the effect",
        response.status,
        refs,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("[agent-effects] could not reach the app", error, refs);
    return false;
  }
}
