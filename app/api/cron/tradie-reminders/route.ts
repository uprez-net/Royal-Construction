import { sendTradieReminders } from "@/lib/jobs/tradie-reminder";
import { successResponse, errorResponse } from "@/utils/validators";

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
    const result = await sendTradieReminders();
    return successResponse(result);
  } catch (error) {
    console.error("/api/cron/tradie-reminders GET error", error);
    return errorResponse("Failed to send tradie reminders", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
