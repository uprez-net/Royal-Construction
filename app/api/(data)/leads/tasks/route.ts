import { NextRequest } from "next/server";

import { createLeadTask, listOpenTasks } from "@/lib/data/lead-tasks";
import {
  badRequestResponse,
  createLeadTaskSchema,
  errorResponse,
  successResponse,
} from "@/utils/validators";

export async function GET() {
  try {
    return successResponse(await listOpenTasks());
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
      dueDate: dueDate ? new Date(dueDate) : null,
      dueTime,
      notes,
    });
    return successResponse(task, { status: 201 });
  } catch (error) {
    console.error("/api/leads/tasks POST error", error);
    return errorResponse("Failed to create task", {
      status: 500,
      code: "LEAD_TASK_CREATE_FAILED",
    });
  }
}
