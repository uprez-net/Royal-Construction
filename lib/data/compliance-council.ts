"use server";

import {
  ComplianceAlertType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import { resolveComplianceAlertBySystem } from "@/lib/data/compliance-alerts";
import { generatePartyRefToken } from "@/lib/graph/party-subject";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  outreachForParty,
  type CertifierEngagementDetail,
} from "@/types/compliance";
import type { PlanningCertificateInput } from "@/utils/validators/compliance";
import { logAction } from "./actionLog";

/**
 * The 10.7(2) & (5) certificate, tracked as something being obtained.
 *
 * Its own module rather than an addition to compliance-outreach.ts, because the
 * council is not an outreach in the sense that file means: nothing is emailed,
 * nobody is picked from a directory, and the thing being waited on is a portal
 * transaction rather than a reply. What the two share is the engagement, the
 * revalidation tags and — once an application is lodged — a thread for the
 * portal's own mail to land on, which is the one place this reaches across.
 *
 * The whole reason this exists is that the answer used to live in component
 * state. "Do you already have the planning certificate?" was asked on every
 * render, answered into `useState`, and forgotten on navigation — so a job
 * where somebody had lodged an application three days ago looked identical to
 * one where nobody had done anything at all, and the three-to-five working days
 * the portal takes were three to five days nobody could see elapsing.
 */

function revalidateEngagement(projectId: string) {
  revalidateTag(`project-${projectId}`, CACHE_PROFILES.SHORT);
  revalidateTag(`certifier-engagement-${projectId}`, CACHE_PROFILES.SHORT);
}

async function requireEngagement(
  projectId: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await prisma.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
  if (!engagement) {
    throw new Error(
      "This project has no compliance file yet. Connect with a certifier first.",
    );
  }
  return engagement;
}

/**
 * Makes sure the council has a thread for the portal to write to.
 *
 * The COUNCIL outreach row has existed in the schema since party outreach was
 * built and nothing has ever created one, which quietly made the portal branch
 * of the inbound matcher dead code: `matchPartyOutreach` looks for council rows
 * when mail arrives from the configured portal address, and there were none to
 * find. So a certificate emailed back by the portal landed in the lead queue.
 *
 * Written when an application is lodged, which is the first moment there is
 * anything true to record. Status SENT because we have genuinely asked — through
 * their website rather than by email, which the portal does not care about and
 * which is exactly the kind of distinction that should not decide whether their
 * reply can be filed. `sentAt` carries the lodgement date so the overdue sweep
 * measures the portal's clock from when the portal's clock actually started.
 *
 * Idempotent: a second lodgement, or a corrected date, updates the row rather
 * than colliding with the unique index on [engagementId, party].
 */
async function ensureCouncilThread(
  engagement: CertifierEngagementDetail,
  appliedAt: Date,
): Promise<void> {
  const existing = outreachForParty(engagement, CompliancePartyType.COUNCIL);

  if (existing) {
    await prisma.complianceOutreach.update({
      where: { id: existing.id },
      data: {
        status: ComplianceOutreachStatus.SENT,
        sentAt: appliedAt,
      },
    });
    return;
  }

  await prisma.complianceOutreach.create({
    data: {
      engagementId: engagement.id,
      party: CompliancePartyType.COUNCIL,
      // Minted even though nothing carrying it is ever sent. It costs nothing,
      // it keeps the column non-null on every row, and a thread that later has
      // to become a real one already has the thing it cannot be given
      // retroactively.
      refToken: generatePartyRefToken(CompliancePartyType.COUNCIL),
      mode: ComplianceOutreachMode.OUTREACH,
      status: ComplianceOutreachStatus.SENT,
      sentAt: appliedAt,
    },
  });
}

/**
 * Records where the planning certificate has got to.
 *
 * One function for all four steps rather than four endpoints, because they are
 * four answers to one question and the row they write to is the same row. The
 * step is explicit in the payload rather than inferred from which fields are
 * present: inferring it meant an admin correcting a typo'd application number
 * looked identical to one lodging a fresh application, and the second resets a
 * clock the first must not touch.
 */
export async function recordPlanningCertificate(
  projectId: string,
  input: PlanningCertificateInput,
  recordedBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);

  switch (input.step) {
    case "answer": {
      await prisma.planningCertificateApplication.upsert({
        where: { engagementId: engagement.id },
        create: {
          engagementId: engagement.id,
          alreadyHeld: input.alreadyHeld,
        },
        // Only the answer. Changing it from "no" back to "yes" must not silently
        // discard a lodged application — if one exists it stays on the row, and
        // the block reads as received-or-lodged rather than re-asking.
        update: { alreadyHeld: input.alreadyHeld },
      });
      break;
    }

    case "applied": {
      await prisma.planningCertificateApplication.upsert({
        where: { engagementId: engagement.id },
        create: {
          engagementId: engagement.id,
          // Lodging one is the answer to the question, so the two cannot
          // disagree: nobody applies for a certificate they already hold.
          alreadyHeld: false,
          appliedAt: input.appliedAt,
          applicationRef: input.applicationRef ?? null,
          lodgedWith: input.lodgedWith ?? null,
        },
        update: {
          alreadyHeld: false,
          appliedAt: input.appliedAt,
          applicationRef: input.applicationRef ?? null,
          lodgedWith: input.lodgedWith ?? null,
        },
      });

      await ensureCouncilThread(engagement, input.appliedAt);
      break;
    }

    case "received": {
      await prisma.planningCertificateApplication.upsert({
        where: { engagementId: engagement.id },
        create: {
          engagementId: engagement.id,
          alreadyHeld: false,
          receivedAt: input.received ? new Date() : null,
        },
        update: { receivedAt: input.received ? new Date() : null },
      });

      if (input.received) {
        // The wait is over, so the alert about the wait is answered. Closed by
        // the system rather than left for somebody to tick off: asking an admin
        // to confirm what they have just told us is asking them to rubber-stamp
        // it, and an alert that outlives its cause is how a panel full of
        // alerts stops being read.
        await resolveComplianceAlertBySystem({
          projectId,
          engagementId: engagement.id,
          type: ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
          resolutionNote: "The planning certificate came back.",
        });
      }
      break;
    }
  }

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("compliancePlanningCertificateUpdated", {
        projectId,
        engagementId: engagement.id,
        step: input.step,
        recordedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

/**
 * Marks the certificate as arrived because its file just did.
 *
 * The upload is the stronger statement of the two: somebody ticking "received"
 * is reporting it, and somebody attaching the PDF is proving it. So an upload
 * against a row nobody ticked closes the wait anyway, rather than leaving an
 * overdue alert open underneath a certificate sitting on the file.
 *
 * Never throws, and never overwrites a receivedAt that is already there. It
 * runs in an `after()` behind an upload that has already succeeded, and the
 * upload is the thing that mattered.
 */
export async function recordPlanningCertificateArrival(params: {
  projectId: string;
  engagementId: string;
}): Promise<void> {
  try {
    const claimed = await prisma.planningCertificateApplication.updateMany({
      where: { engagementId: params.engagementId, receivedAt: null },
      data: { receivedAt: new Date() },
    });

    if (claimed.count === 0) {
      // Either it is already marked received, or the question was never asked
      // and there is no row. The second is the case where a builder simply
      // uploaded the certificate they were holding without answering anything,
      // which is a perfectly reasonable way to use the block.
      await prisma.planningCertificateApplication.upsert({
        where: { engagementId: params.engagementId },
        create: {
          engagementId: params.engagementId,
          alreadyHeld: true,
          receivedAt: new Date(),
        },
        update: {},
      });
    }

    await resolveComplianceAlertBySystem({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: ComplianceAlertType.PLANNING_CERTIFICATE_DELAYED,
      resolutionNote: "The planning certificate was uploaded to the file.",
    });
  } catch (error) {
    console.error(
      "  Failed to record the planning certificate's arrival:",
      error,
    );
  }
}
