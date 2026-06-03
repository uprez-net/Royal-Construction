import prisma from "@/lib/prisma";
import { createGraphContext } from "@/lib/graph/client";
import { getGraphConfig } from "@/lib/graph/config";
import { successResponse, errorResponse } from "@/utils/validators";
import { toDateOnly } from "@/types/lead";
import { NextResponse } from "next/server";
import FollowUpReminderEmail from "@/lib/graph/Email/follow-up-remainder";
import { render } from "@react-email/components";

// Helper to get today's date in Australia/Sydney timezone
function getSydneyTodayDateString(): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

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
    const todaySydneyStr = getSydneyTodayDateString();
    console.log(`[CRON] Starting followup-lead-reminder cron. Sydney Today: ${todaySydneyStr}`);

    // 2. Fetch leads in IN_FOLLOW_UP stage with assigned users
    const leads = await prisma.lead.findMany({
      where: {
        stage: "IN_FOLLOW_UP",
        followupDate: {
          not: null,
        },
        assignedId: {
          not: null,
        },
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

    // 3. Filter leads whose followupDate (UTC Date) matches today's Sydney date string
    const matchingLeads = leads.filter((lead) => {
      if (!lead.followupDate) return false;
      const leadDateStr = toDateOnly(lead.followupDate);
      return leadDateStr === todaySydneyStr;
    });

    console.log(`[CRON] Found ${leads.length} total active follow-ups. ${matchingLeads.length} matched today's date (${todaySydneyStr}).`);

    if (matchingLeads.length === 0) {
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
    for (const lead of matchingLeads) {
      const assignee = lead.assignedUser;
      if (!assignee || !assignee.email) {
        console.warn(`[CRON] Lead ID ${lead.id} is assigned to a user without an email address.`);
        results.push({ id: lead.id, name: lead.name, status: "skipped_no_email" });
        continue;
      }

      const emailSubject = `[Follow-up Reminder] Today's Follow-up for ${lead.name}`;
      const crmUrl = `${baseUrl}/leads`;

      const emailHtml = await render(
        FollowUpReminderEmail({
          assigneeName: assignee.name || "Team",
          leadName: lead.name,
          leadPhone: lead.phone || "Not provided",
          leadEmail: lead.email || "Not provided",
          leadLocation: lead.location || "Not provided",
          followupTime: lead.followupTime || "Anytime today",
          followupNotes: lead.followupNotes || "",
          crmUrl: crmUrl,
        })
      );

      try {
        await graphClient.sendMail({
          to: assignee.email,
          subject: emailSubject,
          body: emailHtml,
        });
        console.log(`[CRON] Email reminder successfully sent to ${assignee.email} for Lead ID ${lead.id}`);
        results.push({ id: lead.id, name: lead.name, status: "sent", email: assignee.email });
      } catch (err) {
        console.error(`[CRON] Failed to send email reminder for Lead ID ${lead.id} to ${assignee.email}:`, err);
        results.push({
          id: lead.id,
          name: lead.name,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return successResponse({
      message: "Lead follow-up reminders processed.",
      processed: matchingLeads.length,
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
