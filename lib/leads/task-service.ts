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

export interface FetchOpenTasksOptions {
  /**
   * Ask only for these leads' open work.
   *
   * Pass it whenever the caller has a lead in hand. Omitting it asks for open
   * work across the business, which the server caps — so filtering an unscoped
   * response down to one lead is not the same question, and used to come back
   * empty for any lead whose task sorted past the cap.
   */
  leadIds?: number[];
  signal?: AbortSignal;
}

/**
 * Where an open-task request should go, or that it should not be made.
 *
 * Split out from the fetch so the three cases can be asserted directly. The
 * middle one is a genuine trap: scoped-to-no-leads and unscoped differ by an
 * empty array, and a truthiness check reads them as the same thing.
 */
export type OpenTasksRequest = { skip: true } | { skip: false; url: string };

export function openTasksRequest(leadIds?: number[]): OpenTasksRequest {
  // Scoped to no leads is a real answer — an empty filter result — and it is
  // emphatically not "every lead". Falling through to an unscoped request
  // would hand the leads table every open task in the business precisely when
  // it asked for none.
  if (leadIds !== undefined && leadIds.length === 0) return { skip: true };
  // Unscoped sends no parameter at all: the route rejects an empty
  // `?leadIds=` rather than reading it as "everything".
  const query = leadIds ? `?leadIds=${leadIds.join(",")}` : "";
  return { skip: false, url: `/api/leads/tasks${query}` };
}

export function fetchOpenTasks({
  leadIds,
  signal,
}: FetchOpenTasksOptions = {}): Promise<LeadTaskRow[]> {
  const request = openTasksRequest(leadIds);
  if (request.skip) return Promise.resolve([]);
  return unwrap<LeadTaskRow[]>(
    request.url,
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

export function fetchCompletedTasks(
  signal?: AbortSignal,
): Promise<LeadTaskRow[]> {
  return unwrap<LeadTaskRow[]>(
    "/api/leads/tasks?state=completed",
    { method: "GET", cache: "no-store", signal },
    "Failed to fetch completed tasks",
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

/** Puts a closed task back on the open list, dates and note intact. */
export function reopenTask(taskId: number): Promise<LeadTaskRow> {
  return unwrap<LeadTaskRow>(
    `/api/leads/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen" }),
    },
    "Failed to reopen the task",
  );
}

/** Removes the task entirely. Not the same as closing it — see deleteLeadTask. */
export function deleteTask(taskId: number): Promise<{ deleted: boolean }> {
  return unwrap<{ deleted: boolean }>(
    `/api/leads/tasks/${taskId}`,
    { method: "DELETE" },
    "Failed to delete the task",
  );
}
