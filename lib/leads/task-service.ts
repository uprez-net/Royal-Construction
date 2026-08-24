import { fetchJson } from "@/utils/fetch";

import type { LeadTaskRow } from "@/lib/leads/task-types";
import type { CreateLeadTaskBody } from "@/utils/validators/lead-task";

export type { LeadTaskRow };

/** The API wraps every payload as { data, success }. Unwrap once, here. */
async function unwrap<T>(
  input: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  const body = await fetchJson<T>(input, init, fallback);
  if (!body.success) throw new Error(fallback);
  return body.data;
}

export function fetchOpenTasks(signal?: AbortSignal): Promise<LeadTaskRow[]> {
  return unwrap<LeadTaskRow[]>(
    "/api/leads/tasks",
    { method: "GET", cache: "no-store", signal },
    "Failed to fetch tasks",
  );
}

export function createTask(body: CreateLeadTaskBody): Promise<LeadTaskRow> {
  return unwrap<LeadTaskRow>(
    "/api/leads/tasks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    "Failed to create the task",
  );
}

/** Closes the task. Never moves the lead: that is the whole point of tasks. */
export function completeTask(taskId: number): Promise<LeadTaskRow> {
  return unwrap<LeadTaskRow>(
    `/api/leads/tasks/${taskId}`,
    { method: "PATCH" },
    "Failed to update the task",
  );
}
