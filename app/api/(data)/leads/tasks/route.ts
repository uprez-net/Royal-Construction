import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import {
  LeadTaskRejectedError,
  createLeadTask,
  listCompletedTasks,
  listOpenTasks,
} from "@/lib/domain/leads/tasks";
import {
  badRequestResponse,
  createLeadTaskSchema,
  errorResponse,
  parseLeadIdsParam,
  successResponse,
} from "@/utils/validators";
import { resolveActingUserId } from "@/lib/data/acting-user";
import { requireInternalUser } from "@/lib/auth/require-internal-user";

/**
 * Open work by default; `?state=completed` for the history.
 *
 * Defaulting to open keeps every existing caller working unchanged — the
 * Tasks tab and both review dialogs call this with no query string.
 *
 * `?leadIds=1,2,3` narrows open work to those leads. Everything that wanted
 * one lead's tasks used to fetch the unscoped list and filter it here, which
 * quietly depended on that lead's work landing inside the 200-row cap.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireInternalUser();
    if (!guard.ok) {
      return errorResponse(guard.error, { status: 403, code: "FORBIDDEN" });
    }

    // Anything other than the two known values is a caller mistake. Silently
    // treating ?state=complete (or a typo) as "open" would hand back the wrong
    // list and look like data loss.
    const state = request.nextUrl.searchParams.get("state");
    if (state !== null && state !== "open" && state !== "completed") {
      return badRequestResponse('state must be "open" or "completed"');
    }

    const parsedLeadIds = parseLeadIdsParam(
      request.nextUrl.searchParams.get("leadIds"),
    );
    if (!parsedLeadIds.ok) return badRequestResponse(parsedLeadIds.error);

    // The completed list has no scoped caller yet, so rather than accept the
    // parameter and ignore it — which reads as working — say it is not there.
    if (state === "completed") {
      if (parsedLeadIds.leadIds !== undefined) {
        return badRequestResponse(
          "leadIds is not supported with state=completed",
        );
      }
      return successResponse(await listCompletedTasks(prisma));
    }

    return successResponse(
      await listOpenTasks(prisma, { leadIds: parsedLeadIds.leadIds }),
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
    const guard = await requireInternalUser();
    if (!guard.ok) {
      return errorResponse(guard.error, { status: 403, code: "FORBIDDEN" });
    }

    const parsed = createLeadTaskSchema.safeParse(await request.json());
    if (!parsed.success) return badRequestResponse(parsed.error.message);

    const { leadId, type, dueDate, dueTime, notes } = parsed.data;
    const task = await createLeadTask(
      {
        leadId,
        type,
        dueDate: new Date(dueDate),
        dueTime,
        notes,
        // Stamped on the activity entry the task writes. The domain command
        // takes the actor rather than resolving Clerk itself — that is what
        // keeps it callable from Eve, the booking route and a cron.
        actingUserId: await resolveActingUserId(),
      },
      prisma,
    );
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
