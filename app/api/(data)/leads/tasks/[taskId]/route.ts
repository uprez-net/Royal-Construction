import { NextRequest } from "next/server";

import { completeLeadTask } from "@/lib/data/lead-tasks";
import {
  badRequestResponse,
  errorResponse,
  leadTaskParamSchema,
  successResponse,
} from "@/utils/validators";

/** Closing a task. It deliberately never touches the lead's stage. */
export async function PATCH(
  _request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  try {
    const parsed = leadTaskParamSchema.safeParse(await context.params);
    if (!parsed.success) return badRequestResponse(parsed.error.message);

    const task = await completeLeadTask(Number(parsed.data.taskId));
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
