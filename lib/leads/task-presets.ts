import type { LeadTaskType } from "@prisma/client";

import { sydneyMidnightIn } from "@/lib/dates/sydney";

/**
 * The task vocabulary, taken from what people typed rather than invented.
 *
 * Before this field existed the only place to record what a task was was
 * `followupNotes`, a free-text box. On production people wrote:
 *
 *   "Organise a Meeting"        x4    -> MEETING
 *   "Send an Email/Text"        x2    -> EMAIL
 *   "Waiting for information"   x3    -> WAITING
 *   "Called multiple occasions" x1    -> CALL
 *   "Need to call back"         x1    -> CALL
 *
 * Four separate people asked for a meeting task by typing it into a notes
 * field. These four types cover every note recorded on production.
 */
export const LEAD_TASK_TYPES: {
  value: LeadTaskType;
  label: string;
  verb: string;
}[] = [
  { value: "CALL", label: "Call", verb: "Call" },
  { value: "EMAIL", label: "Email or text", verb: "Send an email or text" },
  { value: "MEETING", label: "Meeting", verb: "Organise a meeting" },
  { value: "WAITING", label: "Waiting on them", verb: "Wait for information" },
];

/**
 * Due-date presets, also taken from production notes.
 *
 * Nine notes expressed a due date in prose: "Follow-up in 7 days" x4,
 * "Follow-up in 1 Day" and "Follow-up in 1 day" (the same interval typed with
 * two different capitalisations, which is what a free-text field does to data),
 * "in 1 month", "in 3 months", "in 6 months".
 */
export const LEAD_TASK_DUE_PRESETS: { label: string; days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "In 7 days", days: 7 },
  { label: "In 1 month", days: 30 },
  { label: "In 3 months", days: 90 },
  { label: "In 6 months", days: 180 },
];

/**
 * Resolve a preset to a concrete date.
 *
 * Normalised to midnight so a task created at 4pm is not "overdue" against a
 * bucket boundary the next morning. The buckets compare whole days.
 */
export function dueDateFromPreset(days: number, from: Date): Date {
  return sydneyMidnightIn(days, from);
}

/**
 * Best-effort type for a legacy free-text note.
 *
 * Used by the backfill and kept here so the same rule is testable and reusable
 * if more legacy notes turn up. Order matters: a note can mention more than one
 * thing, and the most specific intent wins.
 */
export function taskTypeFromNote(
  note: string | null | undefined,
): LeadTaskType {
  const n = (note ?? "").toLowerCase();
  if (n.includes("meeting")) return "MEETING";
  if (n.includes("email") || n.includes("text")) return "EMAIL";
  if (n.includes("waiting")) return "WAITING";
  return "CALL";
}
