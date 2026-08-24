import { NextRequest } from "next/server";

import { completeLeadTask, deleteLeadTask, reopenLeadTask } from "@/lib/data/lead-tasks";
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

    // An empty body is not an error here, so a failed parse means "no body".
    const body = await request.json().catch(() => null);
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
    if (action !== undefined && action !== "complete" && action !== "reopen") {
      return badRequestResponse('action must be "complete" or "reopen"');
    }

    const taskId = Number(parsed.data.taskId);
    const task =
      action === "reopen" ? await reopenLeadTask(taskId) : await completeLeadTask(taskId);
    if (!task) {
      return errorResponse("Task not found", { status: 404, code: "LEAD_TASK_NOT_FOUND" });
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
