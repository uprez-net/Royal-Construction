import { NextRequest } from "next/server";

import prisma from "@/lib/prisma";
import {
  authorizeLeadTask,
  completeLeadTask,
  deleteLeadTask,
  reopenLeadTask,
} from "@/lib/domain/leads/tasks";
import { isDomainError } from "@/lib/domain/errors";
import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { userPrincipal } from "@/lib/domain/principal";
import {
  badRequestResponse,
  errorResponse,
  leadTaskParamSchema,
  successResponse,
} from "@/utils/validators";
import { resolveActingUserId } from "@/lib/data/acting-user";

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

    // A taskId straight from the client is not authorization. This route used
    // to act on whatever id it was sent; the check is now the one Eve's tools
    // already made, in lib/domain/leads/tasks.ts.
    const guard = await requireInternalUser();
    if (!guard.ok) {
      return errorResponse(guard.error, { status: 403, code: "FORBIDDEN" });
    }
    try {
      await authorizeLeadTask(userPrincipal(guard.user), taskId, prisma);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      return errorResponse("Task not found", {
        status: 404,
        code: "LEAD_TASK_NOT_FOUND",
      });
    }

    const task =
      action === "reopen"
        ? await reopenLeadTask(taskId, prisma)
        : await completeLeadTask(taskId, prisma, await resolveActingUserId());
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
    const taskId = Number(parsed.data.taskId);
    const guard = await requireInternalUser();
    if (!guard.ok) {
      return errorResponse(guard.error, { status: 403, code: "FORBIDDEN" });
    }
    try {
      await authorizeLeadTask(userPrincipal(guard.user), taskId, prisma);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      // Deleting is idempotent by design — a second delete reports success —
      // so an unreadable task answers the same way a gone one does.
      return successResponse({ deleted: true });
    }
    await deleteLeadTask(taskId, prisma);
    return successResponse({ deleted: true });
  } catch (error) {
    console.error("/api/leads/tasks/[taskId] DELETE error", error);
    return errorResponse("Failed to delete task", {
      status: 500,
      code: "LEAD_TASK_DELETE_FAILED",
    });
  }
}
