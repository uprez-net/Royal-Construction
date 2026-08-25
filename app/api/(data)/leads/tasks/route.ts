import { NextRequest } from "next/server";

import {
  LeadTaskRejectedError,
  createLeadTask,
  listCompletedTasks,
  listOpenTasks,
} from "@/lib/data/lead-tasks";
import {
  badRequestResponse,
  createLeadTaskSchema,
  errorResponse,
  successResponse,
} from "@/utils/validators";

/**
 * Open work by default; `?state=completed` for the history.
 *
 * Defaulting to open keeps every existing caller working unchanged — the
 * Tasks tab and both review dialogs call this with no query string.
 */
export async function GET(request: NextRequest) {
  try {
    // Anything other than the two known values is a caller mistake. Silently
    // treating ?state=complete (or a typo) as "open" would hand back the wrong
    // list and look like data loss.
    const state = request.nextUrl.searchParams.get("state");
    if (state !== null && state !== "open" && state !== "completed") {
      return badRequestResponse('state must be "open" or "completed"');
    }
    return successResponse(
      state === "completed" ? await listCompletedTasks() : await listOpenTasks(),
    );
  } catch (error) {
    console.error("/api/leads/tasks GET error", error);
    return errorResponse("Failed to fetch tasks", {
      status: 500,
      code: "LEAD_TASKS_FETCH_FAILED",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = createLeadTaskSchema.safeParse(await request.json());
    if (!parsed.success) return badRequestResponse(parsed.error.message);

    const { leadId, type, dueDate, dueTime, notes } = parsed.data;
    const task = await createLeadTask({
      leadId,
      type,
      dueDate: new Date(dueDate),
      dueTime,
      notes,
    });
    return successResponse(task, { status: 201 });
  } catch (error) {
    // A rule the operator can satisfy — the lead is archived or closed — is a
    // 409 carrying the reason, not a blanket 500. The composer renders this
    // message verbatim, so it has to say what to do about it.
    if (error instanceof LeadTaskRejectedError) {
      console.warn("/api/leads/tasks POST rejected", { reason: error.message });
      return errorResponse(error.message, {
        status: 409,
        code: "LEAD_TASK_REJECTED",
      });
    }
    console.error("/api/leads/tasks POST error", error);
    return errorResponse("Failed to create task", {
      status: 500,
      code: "LEAD_TASK_CREATE_FAILED",
    });
  }
}
