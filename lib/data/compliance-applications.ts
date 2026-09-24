import "server-only";

import {
  ComplianceAlertSource,
  ComplianceAlertType,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  GraphMailbox,
} from "@prisma/client";
import { revalidateTag } from "next/cache";
import { after } from "next/server";

import {
  EXTERNAL_APPLICATION_COPY,
  externalApplicationForDocumentType,
} from "@/constants/complianceDocuments";
import {
  raiseComplianceAlert,
  resolveComplianceAlertBySystem,
} from "@/lib/data/compliance-alerts";
import { PORTAL_DOWNLOAD_ALERT } from "@/lib/domain/compliance/portal-certificates";
import {
  ComplianceDomainError,
  requireComplianceAccess,
} from "@/lib/compliance/access";
import { generatePartyRefToken } from "@/lib/graph/party-subject";
import prisma from "@/lib/prisma";
import { createActivityLogEntry } from "@/types/activityLog";
import { CACHE_PROFILES } from "@/types/cache";
import {
  certifierEngagementInclude,
  outreachForParty,
  type CertifierEngagementDetail,
} from "@/types/compliance";
import type {
  ExternalApplicationInput,
  PrincipalCertifierInput,
} from "@/utils/validators/compliance";
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
    throw new ComplianceDomainError(
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
 * The two certificate applications are here, and they are the addition. A CDC is
 * determined by a registered certifier rather than by a council, which is why it
 * was not obvious that it belongs — but the determination arrives from the NSW
 * Planning Portal, under the portal's own address, exactly as a development
 * consent does. Without a council row on the file there was nothing for
 * `matchPartyOutreach` to correlate that message to, so the one email that says a
 * CDC has been issued fell through to the lead queue: the whole automatic path to
 * the download alert was dead on the commoner of the two routes.
 *
 * Idempotent: a second lodgement, or a corrected date, updates the row rather
 * than colliding with the unique index on [engagementId, party].
 */
const APPLICATIONS_WITH_A_COUNCIL_THREAD: ReadonlySet<ComplianceExternalApplicationKind> =
  new Set([
    ComplianceExternalApplicationKind.PLANNING_CERTIFICATE_10_7,
    ComplianceExternalApplicationKind.ROAD_OPENING,
    ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
    ComplianceExternalApplicationKind.COMPLYING_DEVELOPMENT_CERTIFICATE,
    ComplianceExternalApplicationKind.CONSTRUCTION_CERTIFICATE,
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
      graphMailbox: GraphMailbox.ADMIN,
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
      // The row and its first round, together. Two statements left a lodgement
      // recorded with no round behind it when the second failed, and the
      // overdue sweep reads the rounds — so an application that was visibly
      // lodged had no clock running on it at all.
      await prisma.$transaction(async (tx) => {
        const application = await tx.complianceExternalApplication.upsert({
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

        // Round one. Written here as well as on the row above, so the rounds
        // table is the complete account from the first lodgement rather than
        // starting at whatever round somebody first resubmitted — which would
        // make "round 2" the first thing the trail ever said.
        //
        // Idempotent through the unique index: an admin correcting the lodgement
        // date is the same round reported again, so the existing row is updated
        // rather than a second one written.
        await tx.complianceApplicationSubmission.upsert({
          where: {
            applicationId_round: { applicationId: application.id, round: 1 },
          },
          create: {
            applicationId: application.id,
            round: 1,
            submittedAt: input.appliedAt,
            applicationRef: input.applicationRef ?? null,
          },
          update: {
            submittedAt: input.appliedAt,
            applicationRef: input.applicationRef ?? null,
          },
        });
      });

      if (APPLICATIONS_WITH_A_COUNCIL_THREAD.has(input.kind)) {
        await ensureCouncilThread(engagement, input.appliedAt);
      }
      break;
    }

    case "resubmitted": {
      /**
       * The round number is read and then written, so it needs both a
       * transaction and a lock, and they answer different problems.
       *
       * The transaction is what keeps the pair atomic. If the submission is
       * created and the update that follows it fails, the file keeps a new round
       * while `receivedAt` still says the application was determined -- the
       * determination clock stays closed on an application that has gone back
       * in, which is precisely the state the rounds table was added to prevent.
       *
       * The lock is what stops two admins colliding, and a transaction on its
       * own does not give it. Postgres runs these at READ COMMITTED, so two
       * resubmissions recorded together both read round N, both compute N+1, and
       * the `applicationId_round` unique index throws the second back at the
       * route as a raw Prisma error.
       *
       * So the row is claimed before the round is read. Clearing `receivedAt` is
       * work this branch has to do anyway -- an application that has gone back in
       * is under assessment again -- and doing it first takes the row-level write
       * lock as a side effect, which is cheaper and plainer than a raw
       * `SELECT ... FOR UPDATE`. A second transaction blocks here until the first
       * commits, and its next statement reads a fresh snapshot carrying round
       * N+1, so it computes N+2 rather than colliding.
       */
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.complianceExternalApplication.updateMany({
          where: { engagementId: engagement.id, kind: input.kind },
          data: { receivedAt: null },
        });

        if (claimed.count === 0) {
          // No row to lock is no application to resubmit, and the same refusal
          // the read below would have given.
          throw new Error(
            "There is no application on this file to resubmit — record the first lodgement instead.",
          );
        }

        const application = await tx.complianceExternalApplication.findUnique({
          where,
          select: {
            id: true,
            applicationRef: true,
            submissions: { orderBy: { round: "desc" }, take: 1 },
          },
        });

        if (!application) {
          // Nothing to resubmit. Refused rather than quietly promoted to a first
          // lodgement, because the two are different facts and the difference is
          // the whole reason this step exists: a "resubmission" of an application
          // nobody recorded lodging is somebody on the wrong row.
          throw new Error(
            "There is no application on this file to resubmit — record the first lodgement instead.",
          );
        }

        const round = (application.submissions[0]?.round ?? 0) + 1;
        // Carried forward when this round does not supply one. Usually the same
        // number, and the round that changes it is the exception a council makes
        // when it closes an application and asks for it to be relodged.
        const applicationRef =
          input.applicationRef ??
          application.submissions[0]?.applicationRef ??
          application.applicationRef ??
          null;

        await tx.complianceApplicationSubmission.create({
          data: {
            applicationId: application.id,
            round,
            submittedAt: input.submittedAt,
            applicationRef,
            note: input.note ?? null,
          },
        });

        // The row's own reference follows the latest round, because that is what
        // every chase quotes and what the inbound correlation matches a council's
        // mail against. `receivedAt` was cleared by the claim above, in the same
        // write that took the lock.
        await tx.complianceExternalApplication.update({
          where: { id: application.id },
          data: { applicationRef },
        });
      });
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

    /**
     * The portal said yes, and sent nothing.
     *
     * Recorded by hand here, and by the inbound notification where the
     * correlation lands one — see `recordPortalDetermination`. The manual route
     * is the one that has to work: nothing in the compliance mail paths has been
     * exercised against a live mailbox, and a determination nobody can record is
     * a file that cannot progress.
     *
     * Two writes and a raise, in that order. The date stops the determination
     * clock; the alert carries the one step left. The alert is raised here rather
     * than left to the nightly sweep because the gap matters: a determination
     * recorded at ten in the morning should not wait until eight in the evening
     * to appear on the panel as something to go and fetch. The sweep still
     * recomputes it, which is what closes it when the certificate lands.
     */
    case "determined": {
      const determinedAt = input.determinedAt ?? new Date();

      await prisma.complianceExternalApplication.upsert({
        where,
        create: {
          engagementId: engagement.id,
          kind: input.kind,
          alreadyHeld: false,
          approvalNotifiedAt: determinedAt,
          applicationRef: input.applicationRef ?? null,
        },
        // `receivedAt` is deliberately left alone. A determination is not the
        // document arriving, and writing both here would collapse the two facts
        // this step exists to keep apart.
        update: {
          approvalNotifiedAt: determinedAt,
          ...(input.applicationRef
            ? { applicationRef: input.applicationRef }
            : {}),
        },
      });

      await resolveComplianceAlertBySystem({
        projectId,
        engagementId: engagement.id,
        type: EXTERNAL_APPLICATION_COPY[input.kind].alertType,
        resolutionNote: `${EXTERNAL_APPLICATION_COPY[input.kind].label} was determined.`,
      });

      const downloadAlert = PORTAL_DOWNLOAD_ALERT[input.kind];
      if (downloadAlert) {
        await raiseComplianceAlert({
          projectId,
          engagementId: engagement.id,
          type: downloadAlert,
          raisedBySource: ComplianceAlertSource.COUNCIL,
          detail: `Determined${
            input.applicationRef ? ` under ${input.applicationRef}` : ""
          }. Download it from the NSW Planning Portal and upload it here.`,
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

    // The download-ready alert, where this kind has one. The upload *is* the
    // download having happened, so this is the one event that closes it — which
    // is why it is resolved here rather than only on the nightly pass. A green
    // "go and fetch it" line sitting above the document somebody has just
    // fetched is the kind of staleness that teaches people to stop reading the
    // panel.
    const downloadAlert = PORTAL_DOWNLOAD_ALERT[kind];
    if (downloadAlert) {
      await resolveComplianceAlertBySystem({
        projectId: params.projectId,
        engagementId: params.engagementId,
        type: downloadAlert,
        resolutionNote: `${EXTERNAL_APPLICATION_COPY[kind].label} was downloaded and is on the file.`,
      });
    }

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

// ---------------------------------------------------------------------------
// The principal certifier appointment
// ---------------------------------------------------------------------------

/**
 * Records that the certifier has been appointed principal certifier.
 *
 * A separate act from engaging them, and a later one. Engaging a certifier is a
 * fee proposal and a checklist; appointing them principal certifier is a form on
 * the NSW Planning Portal naming the person who will inspect the build and issue
 * the occupation certificate. A CDC cannot be determined without it — the
 * application and the appointment go in together — so this is a gate on the
 * lodgement rather than a note beside it. See
 * `certificateLodgementBlockedReason`.
 *
 * Recorded rather than performed, like every portal step on this file: the
 * appointment happens on the website and what is tracked here is the date and
 * the reference, which is everything the gate reads and everything somebody
 * needs to chase it.
 *
 * Lives in this module rather than beside the engagement's own writes because it
 * belongs to the lodgement it unblocks, and because it is read by the same block
 * that records the application.
 *
 * Re-recordable on purpose. An admin correcting a date or adding the reference
 * they did not have to hand is the ordinary second call, so this overwrites
 * rather than refusing — there is no clock hanging off it that a correction
 * could restart, which is what makes that safe.
 */
export async function recordPrincipalCertifier(
  projectId: string,
  input: PrincipalCertifierInput,
  recordedById: string,
  recordedByName: string,
): Promise<CertifierEngagementDetail> {
  const access = await requireComplianceAccess(projectId);
  const engagement = await requireEngagement(projectId);
  if (access.engagement?.id !== engagement.id) {
    throw new ComplianceDomainError(
      "The compliance file does not belong to this project.",
      "NOT_FOUND",
      404,
    );
  }

  await prisma.certifierEngagement.update({
    where: { id: engagement.id },
    data: {
      principalCertifierAppointedAt: input.appointedAt,
      principalCertifierAppointmentRef: input.appointmentRef ?? null,
      principalCertifierAppointedById: recordedById,
    },
  });

  after(async () => {
    revalidateEngagement(projectId);
    await logAction(
      createActivityLogEntry("compliancePrincipalCertifierAppointed", {
        projectId,
        engagementId: engagement.id,
        appointedAt: input.appointedAt.toISOString(),
        appointmentRef: input.appointmentRef ?? null,
        recordedById,
        recordedByName,
      }),
    );
  });

  return requireEngagement(projectId);
}

/**
 * Records a determination read off an inbound portal notification.
 *
 * The automatic counterpart of the `"determined"` step above, and deliberately
 * the weaker of the two routes. It correlates a message to one application and
 * writes the date; everything else — raising the download alert, closing the
 * determination clock — is the same code the manual step runs, so the two cannot
 * end up describing the same event differently.
 *
 * Guarded on the message id rather than on the date being absent, which is the
 * idempotency that matters here. A portal that sends the same approval twice —
 * a resend, a cc, a replayed webhook — must not re-raise a download alert
 * somebody has already closed by uploading the certificate. Guarding on
 * `approvalNotifiedAt IS NULL` would have done that correctly too, right up until
 * an admin recorded the determination by hand first, at which point the second
 * notification would have been silently discarded along with its message id.
 *
 * Never throws. It runs behind a message that has already been stored and is
 * already visible on the thread; a determination this fails to read is one
 * somebody records by hand from the same email.
 */
export async function recordPortalDetermination(params: {
  projectId: string;
  engagementId: string;
  kind: ComplianceExternalApplicationKind;
  messageId: string;
  determinedAt?: Date;
  applicationRef?: string | null;
}): Promise<boolean> {
  try {
    const authorizedEngagement = await prisma.certifierEngagement.findFirst({
      where: { id: params.engagementId, projectId: params.projectId },
      select: { id: true },
    });
    if (!authorizedEngagement) {
      throw new ComplianceDomainError(
        "The compliance file does not belong to this project.",
        "NOT_FOUND",
        404,
      );
    }

    const existing = await prisma.complianceExternalApplication.findUnique({
      where: {
        engagementId_kind: {
          engagementId: params.engagementId,
          kind: params.kind,
        },
      },
      select: {
        id: true,
        approvalNotificationMessageId: true,
        receivedAt: true,
      },
    });

    if (existing?.approvalNotificationMessageId === params.messageId) {
      // The same notification, again. Nothing to do and nothing to announce.
      return false;
    }

    const determinedAt = params.determinedAt ?? new Date();

    await prisma.complianceExternalApplication.upsert({
      where: {
        engagementId_kind: {
          engagementId: params.engagementId,
          kind: params.kind,
        },
      },
      create: {
        engagementId: params.engagementId,
        kind: params.kind,
        alreadyHeld: false,
        approvalNotifiedAt: determinedAt,
        approvalNotificationMessageId: params.messageId,
        applicationRef: params.applicationRef ?? null,
      },
      update: {
        approvalNotifiedAt: determinedAt,
        approvalNotificationMessageId: params.messageId,
      },
    });

    await resolveComplianceAlertBySystem({
      projectId: params.projectId,
      engagementId: params.engagementId,
      type: EXTERNAL_APPLICATION_COPY[params.kind].alertType,
      resolutionNote: `${EXTERNAL_APPLICATION_COPY[params.kind].label} was determined.`,
    });

    const downloadAlert = PORTAL_DOWNLOAD_ALERT[params.kind];
    if (downloadAlert && !existing?.receivedAt) {
      await raiseComplianceAlert({
        projectId: params.projectId,
        engagementId: params.engagementId,
        type: downloadAlert,
        raisedBySource: ComplianceAlertSource.COUNCIL,
        detail: `The portal has determined this application${
          params.applicationRef ? ` (${params.applicationRef})` : ""
        }. The approval email carries no document — download it from the portal and upload it here.`,
      });
    }

    revalidateEngagement(params.projectId);
    return true;
  } catch (error) {
    console.error(
      `  Failed to record the ${params.kind} determination on ${params.projectId}:`,
      error,
    );
    return false;
  }
}
