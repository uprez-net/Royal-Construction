import prisma from "@/lib/prisma";
import { errorResponse, successResponse } from "@/utils/validators";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "@/lib/notification/novu";

function getSydneyTodayDateString(): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

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
    const todaySydneyStr = getSydneyTodayDateString();
    const todayStart = new Date(`${todaySydneyStr}T00:00:00.000Z`);

    const leads = await prisma.lead.findMany({
      where: {
        // Closed leads get no reminders. This used to be implied by the stage
        // filter; scheduled work is a task now, so it has to be said.
        stage: { notIn: ["CONVERTED", "WON", "LOST", "CANCELLED", "DISQUALIFIED"] },
        meetingDate: {
          not: null,
          lt: todayStart,
        },
        meetingCompletedAt: null,
        assignedId: { not: null },
        meetingReminderSentAt: null,
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    for (const lead of leads) {
      if (!lead.assignedUser?.id) continue;

      const notificationPayload = createNotification("leadMeetingReview", {
        leadId: lead.id.toString(),
        customerName: lead.name,
        meetingDate: lead.meetingDate ? lead.meetingDate.toISOString().slice(0, 10) : undefined,
        meetingTime: lead.meetingTime ?? undefined,
        meetingMode: lead.meetingMode ?? undefined,
      });

      await triggerNotification([lead.assignedUser.id], notificationPayload);

      await prisma.lead.update({
        where: { id: lead.id },
        data: { meetingReminderSentAt: new Date() },
      });
    }

    return successResponse({
      message: "Meeting review reminders processed.",
      processed: leads.length,
    });
  } catch (error) {
    console.error("[CRON_ERROR] Failed during meeting-review-reminder cron execution:", error);
    return errorResponse("Failed to process meeting review reminders", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
