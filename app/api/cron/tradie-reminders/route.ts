import { cronOutcome, withCronReporting } from "@/lib/observability/cron";
import { remindStaleInvoices } from "@/lib/jobs/stale-invoice-reminder";
import { sendTradieReminders } from "@/lib/jobs/tradie-reminder";
import { successResponse, errorResponse } from "@/utils/validators";

async function handle(request: Request) {
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
    const result = await sendTradieReminders();
    // The same daily run nudges the office about emailed invoices nobody has
    // confirmed (#588). Its failure must not stop the tradie reminders, which
    // have already gone, nor hide that they did.
    const invoices = await remindStaleInvoices().catch((error) => {
      console.error("/api/cron/tradie-reminders stale invoices error", error);
      return { failed: 1, reminded: 0 };
    });
    // The run answers 200 even when some reminders failed, so the monitor has to
    // be told: a non-zero `failed` is a run that did not do its job.
    return cronOutcome(
      successResponse({ ...result, staleInvoices: invoices }),
      {
        failed: result.failed + invoices.failed,
      },
    );
  } catch (error) {
    console.error("/api/cron/tradie-reminders GET error", error);
    return errorResponse("Failed to send tradie reminders", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}

export const GET = withCronReporting("/api/cron/tradie-reminders", handle);
