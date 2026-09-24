import { CertifierEngagementStatus } from "@prisma/client";

import { assessOverdueConditions } from "@/lib/domain/compliance/overdue";
import {
  raiseComplianceAlert,
  resolveComplianceAlertBySystem,
} from "@/lib/data/compliance-alerts";
import prisma from "@/lib/prisma";
import { certifierEngagementInclude } from "@/types/compliance";
import { errorResponse, successResponse } from "@/utils/validators";

/**
 * The nightly sweep for waits that have gone past their quoted turnaround.
 *
 * Everything else on the compliance file is raised by something arriving — a
 * reply, a document, a classification. These six conditions are the opposite:
 * they are raised by nothing arriving, and an absence has to be looked for.
 * Nobody is going to email us to say the surveyor has not emailed us.
 *
 * Runs over every live engagement rather than over a queue of due items. That
 * is a deliberate trade: the sweep is O(open jobs) once a day, which is small,
 * and it means the answer is recomputed in full each night rather than
 * depending on a scheduled row having been written correctly weeks earlier.
 * The half that matters is the closing — an alert has to come off the panel
 * when the thing it was waiting for arrives, and the arrival hooks that do that
 * on the happy path do not cover every route a wait can end by. A full
 * recompute is what makes those cases self-correct within a day instead of
 * leaving a stale alert on screen forever.
 *
 * The decision itself is `assessOverdueConditions`, which is pure and tested.
 * This handler is the loop, the auth and the write.
 */
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
    const engagements = await prisma.certifierEngagement.findMany({
      // A closed file has nobody outstanding on it by definition, and sweeping
      // it would keep raising conditions about a job that finished last year.
      where: { status: { not: CertifierEngagementStatus.APPROVED } },
      include: certifierEngagementInclude,
    });

    // One instant for the whole run. Reading the clock per engagement would
    // mean a sweep that takes a minute could put two jobs on different sides of
    // midnight, which is a difference nobody could reproduce later.
    const now = new Date();

    let raised = 0;
    let resolved = 0;
    let failed = 0;

    for (const engagement of engagements) {
      try {
        const assessment = assessOverdueConditions(engagement, now);

        for (const alert of assessment.raise) {
          // `raiseComplianceAlert` collapses onto the one already open, so a
          // condition that has been overdue for a fortnight is one alert rather
          // than fourteen. That is what makes it safe to run this blindly every
          // night.
          const result = await raiseComplianceAlert({
            projectId: engagement.projectId,
            engagementId: engagement.id,
            type: alert.type,
            raisedBySource: alert.source,
            detail: alert.detail,
          });
          if (result.created) raised += 1;
        }

        for (const condition of assessment.resolve) {
          const closed = await resolveComplianceAlertBySystem({
            projectId: engagement.projectId,
            engagementId: engagement.id,
            type: condition.type,
            resolutionNote: condition.note,
          });
          if (closed) resolved += 1;
        }
      } catch (error) {
        // One bad engagement must not silence every job behind it. Logged with
        // the id, because the next run will hit the same one and the log is
        // where that pattern becomes visible.
        console.error(
          `[CRON] Compliance sweep failed for engagement ${engagement.id}:`,
          error,
        );
        failed += 1;
      }
    }

    return successResponse({
      message: "Compliance overdue sweep processed.",
      engagements: engagements.length,
      raised,
      resolved,
      failed,
    });
  } catch (error) {
    console.error(
      "[CRON_ERROR] Failed during compliance-alerts cron execution:",
      error,
    );
    return errorResponse("Failed to sweep compliance alerts", {
      status: 500,
      code: "INTERNAL_ERROR",
    });
  }
}
