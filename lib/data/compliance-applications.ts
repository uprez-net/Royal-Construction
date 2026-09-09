"use server";

import {
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  EXTERNAL_APPLICATION_COPY,
  externalApplicationForDocumentType,
} from "@/constants/complianceDocuments";
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
import type { ExternalApplicationInput } from "@/utils/validators/compliance";
import { logAction } from "./actionLog";

/**
 * The things this file buys rather than asks anybody for.
 *
 * Its own module rather than an addition to compliance-outreach.ts, because
 * none of these is an outreach in the sense that file means: nothing is
 * emailed, nobody is picked from a directory, and the thing being waited on is
 * a portal transaction rather than a reply. What they share with an outreach is
 * the engagement, the revalidation tags and — once an application is lodged — a
 * thread for the body's own mail to land on, which is the one place this
 * reaches across.
 *
 * This began as the 10.7 certificate alone, and the reason it existed then is
 * the reason it now covers five things: the answer used to live in component
 * state. "Do you already have the planning certificate?" was asked on every
 * render, answered into `useState`, and forgotten on navigation — so a job
 * where somebody had lodged an application three days ago looked identical to
 * one where nobody had done anything at all, and the three to five working days
 * the portal takes were days nobody could see elapsing. A road opening permit,
 * a long service levy, a mine subsidence approval and a development application
 * are the same shape of wait, so they are the same rows and the same functions
 * rather than four more copies of a mistake we already made once.
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
 * anything true to record. Status SENT because we have genuinely asked —
 * through their website rather than by email, which the portal does not care
 * about and which is exactly the kind of distinction that should not decide
 * whether their reply can be filed. `sentAt` carries the lodgement date so the
 * overdue sweep measures the portal's clock from when it actually started.
 *
 * Only the applications the council or the portal answers by email get one.
 * Nothing arrives back from the long service levy — the receipt is downloaded
 * from a screen — so a thread there would be a correspondent who never writes.
 *
 * Idempotent: a second lodgement, or a corrected date, updates the row rather
 * than colliding with the unique index on [engagementId, party].
 */
const APPLICATIONS_WITH_A_COUNCIL_THREAD: ReadonlySet<ComplianceExternalApplicationKind> =
  new Set([
    ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
    ComplianceExternalApplicationKind.ROAD_OPENING,
    ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
  ]);

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
        // Only ever moved earlier. A file with a 10.7 lodged in March and a
        // road opening lodged in July has one council thread, and the clock on
        // it belongs to whichever wait started first — the sweep measures each
        // application off its own `appliedAt` anyway, so overwriting this with
        // the later date would only make the thread claim the council was
        // written to more recently than they were.
        sentAt:
          existing.sentAt && existing.sentAt < appliedAt
            ? existing.sentAt
            : appliedAt,
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
 * Records where one application has got to.
 *
 * One function for all three steps and all five kinds rather than fifteen
 * endpoints, because they are answers to one question about one row. The step
 * is explicit in the payload rather than inferred from which fields are
 * present: inferring it meant an admin correcting a typo'd application number
 * looked identical to one lodging a fresh application, and the second resets a
 * clock the first must not touch.
 */
export async function recordExternalApplication(
  projectId: string,
  input: ExternalApplicationInput,
  recordedBy: string,
): Promise<CertifierEngagementDetail> {
  const engagement = await requireEngagement(projectId);
  const where = {
    engagementId_kind: { engagementId: engagement.id, kind: input.kind },
  };

  switch (input.step) {
    case "answer": {
      await prisma.complianceExternalApplication.upsert({
        where,
        create: {
          engagementId: engagement.id,
          kind: input.kind,
          alreadyHeld: input.alreadyHeld,
        },
        // Only the answer. Changing it from "no" back to "yes" must not
        // silently discard a lodged application — if one exists it stays on the
        // row, and the block reads as received-or-lodged rather than re-asking.
        update: { alreadyHeld: input.alreadyHeld },
      });
      break;
    }

    case "applied": {
      await prisma.complianceExternalApplication.upsert({
        where,
        create: {
          engagementId: engagement.id,
          kind: input.kind,
          // Lodging one is the answer to the question, so the two cannot
          // disagree: nobody applies for something they already hold.
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

      if (APPLICATIONS_WITH_A_COUNCIL_THREAD.has(input.kind)) {
        await ensureCouncilThread(engagement, input.appliedAt);
      }
      break;
    }

    case "received": {
      await prisma.complianceExternalApplication.upsert({
        where,
        create: {
          engagementId: engagement.id,
          kind: input.kind,
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
          type: EXTERNAL_APPLICATION_COPY[input.kind].alertType,
          resolutionNote: `${EXTERNAL_APPLICATION_COPY[input.kind].label} came back.`,
        });
      }
      break;
    }
  }

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("complianceExternalApplicationUpdated", {
        projectId,
        engagementId: engagement.id,
        kind: input.kind,
        step: input.step,
        recordedBy,
      }),
    );
  });

  return requireEngagement(projectId);
}

/**
 * Marks an application as arrived because its document just did.
 *
 * The upload is the stronger statement of the two: somebody ticking "received"
 * is reporting it, and somebody attaching the PDF is proving it. So an upload
 * against a row nobody ticked closes the wait anyway, rather than leaving an
 * overdue alert open underneath a certificate sitting on the file.
 *
 * A no-op for a document type no application produces, which is almost all of
 * them — this runs behind every compliance upload, and the four types it does
 * cover are looked up rather than branched on so a sixth application is a row
 * in a table rather than a condition here.
 *
 * Never throws, and never overwrites a receivedAt that is already there. It
 * runs in an `after()` behind an upload that has already succeeded, and the
 * upload is the thing that mattered.
 */
export async function recordExternalApplicationArrival(params: {
  projectId: string;
  engagementId: string;
  documentType: ComplianceDocumentType;
}): Promise<void> {
  const kind = externalApplicationForDocumentType(params.documentType);
  if (!kind) return;

  try {
    const claimed = await prisma.complianceExternalApplication.updateMany({
      where: { engagementId: params.engagementId, kind, receivedAt: null },
      data: { receivedAt: new Date() },
    });

    if (claimed.count === 0) {
      // Either it is already marked received, or the question was never asked
      // and there is no row. The second is the case where a builder simply
      // uploaded the certificate they were holding without answering anything,
      // which is a perfectly reasonable way to use the block.
      await prisma.complianceExternalApplication.upsert({
        where: {
          engagementId_kind: { engagementId: params.engagementId, kind },
        },
        create: {
          engagementId: params.engagementId,
          kind,
          alreadyHeld: true,
          receivedAt: new Date(),
        },
        update: {},
      });
    }

    await resolveComplianceAlertBySystem({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: EXTERNAL_APPLICATION_COPY[kind].alertType,
      resolutionNote: `${EXTERNAL_APPLICATION_COPY[kind].label} was uploaded to the file.`,
    });

    // The consent arriving is what ends the development approval condition, and
    // ending it is what unfreezes the checklist so the builder can go back to
    // collecting for the certifier.
    //
    // Keyed on the document rather than on somebody ticking the application as
    // received, which is the weaker of the two statements: a tick is a report
    // and the notice of determination is proof. A certifier asked to resume
    // assessing on the strength of a ticked box has nothing to read.
    if (kind === ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION) {
      await resolveComplianceAlertBySystem({
        projectId: params.projectId,
        engagementId: params.engagementId,
        type: ComplianceAlertType.DA_APPROVAL_REQUIRED,
        resolutionNote:
          "The council granted development consent, and it is on the file.",
      });
    }
  } catch (error) {
    console.error(
      `  Failed to record the arrival of the ${kind} application:`,
      error,
    );
  }
}
