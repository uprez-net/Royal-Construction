import { NextRequest } from "next/server";

import {
  completeLeadTask,
  deleteLeadTask,
  reopenLeadTask,
} from "@/lib/data/lead-tasks";
import {
  badRequestResponse,
  errorResponse,
  leadTaskParamSchema,
  successResponse,
} from "@/utils/validators";

/**
 * Closing or reopening a task. Neither ever touches the lead's stage.
 *
 * The body is optional and absent means "complete": every caller that predates
 * reopening sends no body at all, and a 400 for them would have broken the
 * Done button and both review dialogs.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const parsed = leadTaskParamSchema.safeParse(await context.params);
    if (!parsed.success) return badRequestResponse(parsed.error.message);

    // Read as text so "no body" and "broken body" stay distinguishable.
    //
    // `request.json().catch(() => null)` collapsed the two, and the fallback
    // for a missing body is "complete" — so a malformed reopen request would
    // have silently CLOSED the task instead of failing. An empty body is the
    // legacy contract and still means complete; anything present must parse.
    const raw = await request.text();
    let action: unknown;
    if (raw.trim()) {
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return badRequestResponse("Request body must be valid JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return badRequestResponse("Request body must be a JSON object");
      }
      action = (body as { action?: unknown }).action;
    }
    if (action !== undefined && action !== "complete" && action !== "reopen") {
      return badRequestResponse('action must be "complete" or "reopen"');
    }

    const taskId = Number(parsed.data.taskId);
    const task =
      action === "reopen"
        ? await reopenLeadTask(taskId)
        : await completeLeadTask(taskId);
    if (!task) {
      return errorResponse("Task not found", {
        status: 404,
        code: "LEAD_TASK_NOT_FOUND",
      });
    }
    return successResponse(task);
  } catch (error) {
    console.error("/api/leads/tasks/[taskId] PATCH error", error);
    return errorResponse("Failed to update task", {
      status: 500,
      code: "LEAD_TASK_UPDATE_FAILED",
    });
  }
}

/**
 * Remove a task that should never have been booked.
 *
 * Separate from PATCH on purpose: completing a task asserts the work happened,
 * and using it to clear a mistake put a call that was never made into the
 * record.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const parsed = leadTaskParamSchema.safeParse(await context.params);
    if (!parsed.success) return badRequestResponse(parsed.error.message);

    // Deleting an already-deleted task is not a failure the operator can act
    // on, so this answers success either way.
    await deleteLeadTask(Number(parsed.data.taskId));
    return successResponse({ deleted: true });
  } catch (error) {
    console.error("/api/leads/tasks/[taskId] DELETE error", error);
    return errorResponse("Failed to delete task", {
      status: 500,
      code: "LEAD_TASK_DELETE_FAILED",
    });
  }
}
