import prisma from "@/lib/prisma";
import {
  sydneyDateOnly,
  sydneyStartOfDay,
  sydneyToday,
} from "@/lib/dates/sydney";
import { errorResponse, successResponse } from "@/utils/validators";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "@/lib/notification/novu";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return errorResponse("Cron not configured", {
      status: 500,
      code: "CONFIG_ERROR",
    });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse("Unauthorized", {
      status: 401,
      code: "UNAUTHORIZED",
    });
  }

  try {
    const todaySydneyStr = sydneyToday();
    // Sydney midnight as an instant, not a UTC string wearing a Sydney date.
    // `new Date(`${todaySydneyStr}T00:00:00.000Z`)` parsed the Sydney calendar
    // date as UTC, which is ten or eleven hours adrift depending on daylight
    // saving. Meetings held during that window were either reminded a day early
    // or missed entirely.
    const todayStart = sydneyStartOfDay(todaySydneyStr);

    // Reads LeadTask, not Lead.meetingDate. #193 moved the Follow-ups tab to
    // tasks and left this behind, so a meeting booked through the new form was
    // invisible here.
    const pastMeetings = await prisma.leadTask.findMany({
      where: {
        type: "MEETING",
        completedAt: null,
        reminderSentAt: null,
        dueDate: { not: null, lt: todayStart },
        lead: {
          stage: {
            notIn: ["CONVERTED", "WON", "LOST", "CANCELLED", "DISQUALIFIED"],
          },
        },
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        lead: {
          include: {
            assignedUser: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    let sent = 0;
    let failed = 0;

    for (const task of pastMeetings) {
      const lead = task.lead;
      const assignee = task.assignedTo ?? lead.assignedUser;
      if (!assignee?.id) continue;

      const notificationPayload = createNotification("leadMeetingReview", {
        leadId: lead.id.toString(),
        customerName: lead.name,
        meetingDate: task.dueDate ? sydneyDateOnly(task.dueDate) : undefined,
        meetingTime: task.dueTime ?? undefined,
        meetingMode: lead.meetingMode ?? undefined,
      });

      // triggerNotification reports failure by RETURNING { success: false } —
      // it catches everything internally and never throws, including the case
      // where the assignee has no Clerk id and there is nobody to notify. The
      // catch below therefore never ran: `failed` was always 0 and every task
      // got stamped whether or not anything was delivered. Since the query
      // filters on reminderSentAt: null, a silent failure removed that meeting
      // from the reminder set permanently. Check the result, not just throws.
      let result: Awaited<ReturnType<typeof triggerNotification>>;
      try {
        result = await triggerNotification([assignee.id], notificationPayload);
      } catch (err) {
        // Kept for genuinely unexpected throws. Do not stamp, and do not abort
        // the run: one bad notification must not silence every meeting behind it.
        console.error(`[CRON] Notification threw for task ${task.id}:`, err);
        failed += 1;
        continue;
      }
      if (!result.success) {
        console.error(
          `[CRON] Notification not delivered for task ${task.id}: ${result.error ?? "unknown reason"}`,
        );
        failed += 1;
        // Left unstamped on purpose so the next run picks it up again.
        continue;
      }

      // Stamped only after delivery, and on the task rather than the lead: a
      // lead can hold several meetings, and marking the lead would silence
      // the rest of them.
      await prisma.leadTask.update({
        where: { id: task.id },
        data: { reminderSentAt: new Date() },
      });
      sent += 1;
    }

    return successResponse({
      message: "Meeting review reminders processed.",
      processed: pastMeetings.length,
      sent,
      failed,
    });
  } catch (error) {
    console.error(
      "[CRON_ERROR] Failed during meeting-review-reminder cron execution:",
      error,
    );
    return errorResponse("Failed to process meeting review reminders", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
