import { z } from "zod";

/** Mirrors the Prisma enum. Kept as a literal list so a schema drift is a
 *  compile error at the call site rather than a runtime 500. */
export const leadTaskTypes = [
  "CALL",
  "EMAIL",
  "MEETING",
  "WAITING",
  "WHATSAPP",
] as const;

export const createLeadTaskSchema = z.object({
  leadId: z.number().int().positive(),
  type: z.enum(leadTaskTypes),
  dueDate: z.iso.datetime(),
  // HH:mm, matching the existing followupTime/meetingTime strings on Lead.
  // max(10) accepted "banana" and "99:99", which would render as-is on a row.
  dueTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm")
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type CreateLeadTaskBody = z.infer<typeof createLeadTaskSchema>;

export const leadTaskParamSchema = z.object({
  taskId: z.string().trim().regex(/^\d+$/, "Task id must be numeric"),
});

/**
 * How many leads one task request may name.
 *
 * The leads table asks for the tasks of every lead it is rendering, which is a
 * filtered page and not the whole business. This bounds the `IN` clause the
 * way `limit` bounds the unscoped query — and it rejects rather than trims,
 * because a caller that names 300 leads and is handed the tasks of 200 has no
 * way to tell that the rest are missing instead of idle.
 */
export const MAX_TASK_LEAD_IDS = 200;

export type LeadIdsParam =
  | { ok: true; leadIds: number[] | undefined }
  | { ok: false; error: string };

/**
 * Parse `?leadIds=1,2,3` into the ids to scope open work to.
 *
 * Absent means "every live lead" and is the default every existing caller
 * relies on. Present-but-empty is a caller mistake, not a synonym for absent:
 * a UI that builds the list from a page of leads and gets it wrong would
 * otherwise silently ask for the entire business and render it.
 */
export function parseLeadIdsParam(raw: string | null): LeadIdsParam {
  if (raw === null) return { ok: true, leadIds: undefined };

  const parts = raw.split(",").map((p) => p.trim());
  if (parts.some((p) => p === "")) {
    return {
      ok: false,
      error: "leadIds must be a comma-separated list of ids",
    };
  }
  if (parts.some((p) => !/^\d+$/.test(p))) {
    return { ok: false, error: "leadIds must contain only numeric ids" };
  }

  // Deduplicated before the length check so a repeated id cannot push a
  // legitimate request over the limit.
  const leadIds = [...new Set(parts.map(Number))];
  if (leadIds.some((id) => id <= 0 || !Number.isSafeInteger(id))) {
    return { ok: false, error: "leadIds must contain only positive ids" };
  }
  if (leadIds.length > MAX_TASK_LEAD_IDS) {
    return {
      ok: false,
      error: `leadIds accepts at most ${MAX_TASK_LEAD_IDS} ids`,
    };
  }
  return { ok: true, leadIds };
}
