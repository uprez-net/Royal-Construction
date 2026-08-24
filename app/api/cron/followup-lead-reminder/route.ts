import prisma from "@/lib/prisma";
import { sydneyDateOnly, sydneyEndOfDay, sydneyToday } from "@/lib/dates/sydney";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { successResponse, errorResponse } from "@/utils/validators";
import FollowUpReminderEmail from "@/lib/graph/Email/follow-up-remainder";
import { render } from "@react-email/components";
import { createNotification } from "@/types/notification";
import { triggerNotification } from "@/lib/notification/novu";


export async function GET(request: Request) {
  // 1. Authorization check for Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error("[CRON_ERROR] CRON_SECRET is not configured in production env.");
      return errorResponse("Cron not configured", {
        status: 500,
        code: "CONFIG_ERROR",
      });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn("[CRON_WARN] Unauthorized attempt to trigger followup-lead-reminder cron.");
      return errorResponse("Unauthorized", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
  }

  try {
    const todaySydneyStr = sydneyToday();
    console.log(`[CRON] Starting followup-lead-reminder cron. Sydney Today: ${todaySydneyStr}`);

    // 2. Fetch open tasks that are due, and the lead each belongs to.
    //
    // Reads LeadTask, not Lead.followupDate. The Follow-ups tab moved to tasks
    // in #193 and this did not, so every task created through the new form was
    // invisible here: createLeadTask never writes the old column, and no
    // reminder would ever have fired for one.
    //
    // Meetings are excluded; meeting-review-reminder owns those.
    const dueTasks = await prisma.leadTask.findMany({
      where: {
        completedAt: null,
        reminderSentAt: null,
        type: { not: "MEETING" },
        dueDate: { not: null, lte: sydneyEndOfDay(todaySydneyStr) },
        lead: {
          // Closed leads get no reminders.
          stage: { notIn: ["CONVERTED", "WON", "LOST", "CANCELLED", "DISQUALIFIED"] },
        },
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        lead: {
          include: { assignedUser: { select: { id: true, name: true, email: true } } },
        },
      },
    });

    // 3. Narrow to tasks whose Sydney due date is today.
    //
    // Unchanged in spirit: a reminder fires on the day, not for the whole
    // backlog. Staging carries follow-ups up to 194 days overdue and widening
    // this would email the lot in one run, which is a decision about how much
    // mail to send rather than a bug to fix here.
    const matching = dueTasks.filter(
      (t) => t.dueDate !== null && sydneyDateOnly(t.dueDate) === todaySydneyStr,
    );

    console.log(`[CRON] Found ${dueTasks.length} open due tasks. ${matching.length} matched today's Sydney date (${todaySydneyStr}).`);

    if (matching.length === 0) {
      return successResponse({
        message: "No lead follow-up reminders due today.",
        processed: 0,
        remindedLeads: [],
      });
    }

    // 4. Initialize Microsoft Graph client
    const config = getGraphConfig();
    const graphClient = await createGraphContext(config);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://royal-construction-chi.vercel.app";

    const results = [];

    // 5. Send reminder emails to each assigned user
    for (const task of matching) {
      const lead = task.lead;
      // The task's own assignee wins; it is set from the lead when the task is
      // created, so this only differs once tasks can be reassigned.
      const assignee = task.assignedTo ?? lead.assignedUser;
      if (!assignee || !assignee.email) {
        console.warn(`[CRON] Task ${task.id} on lead ${lead.id} has no assignee email.`);
        results.push({ id: lead.id, taskId: task.id, name: lead.name, status: "skipped_no_email" });
        continue;
      }

      const notificationPayload = createNotification("leadFollowupDue", {
        leadId: lead.id.toString(),
        customerName: lead.name,
        followupDate: task.dueDate ? sydneyDateOnly(task.dueDate) : undefined,
        followupTime: task.dueTime ?? undefined,
      });

      await triggerNotification([assignee.id], notificationPayload);

      const emailSubject = `[Follow-up Reminder] Today's Follow-up for ${lead.name}`;
      const crmUrl = `${baseUrl}/leads`;

      const emailHtml = await render(
        FollowUpReminderEmail({
          assigneeName: assignee.name || "Team",
          leadName: lead.name,
          leadPhone: lead.phone || "Not provided",
          leadEmail: lead.email || "Not provided",
          leadLocation: lead.location || "Not provided",
          followupTime: task.dueTime || "Anytime today",
          followupNotes: task.notes || "",
          crmUrl: crmUrl,
        })
      );

      try {
        await graphClient.sendMail({
          to: assignee.email,
          subject: emailSubject,
          body: emailHtml,
        });
        console.log(`[CRON] Reminder sent to ${assignee.email} for task ${task.id} on lead ${lead.id}`);
        // Stamped on the TASK. A lead can carry several tasks now, and marking
        // the lead would silence every other one it has.
        await prisma.leadTask.update({
          where: { id: task.id },
          data: { reminderSentAt: new Date() },
        });
        results.push({ id: lead.id, taskId: task.id, name: lead.name, status: "sent", email: assignee.email });
      } catch (err) {
        console.error(`[CRON] Failed to send reminder for task ${task.id}:`, err);
        results.push({
          id: lead.id,
          taskId: task.id,
          name: lead.name,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return successResponse({
      message: "Lead follow-up reminders processed.",
      processed: matching.length,
      results,
    });
  } catch (error) {
    console.error("[CRON_ERROR] Failed during followup-lead-reminder cron execution:", error);
    return errorResponse("Failed to process follow-up reminders", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
