import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/validators";
import { createDocusignContext } from "@/lib/docusign/client";
import { getDocusignConfig } from "@/lib/docusign/config";
import { findEnvelopeIdBySendAttempt } from "@/lib/docusign/envelope-send-attempt";

/**
 * The backstop for a DocuSign send whose outcome the original request could
 * not confirm — see `UnconfirmedEnvelopeSend` and issue #321.
 *
 * The primary reconcile attempt already happened in-request, a 30-second poll
 * (`waitForEnvelopeBySendAttempt`) at the moment the create call failed. This
 * exists for the rows that outlive that: DocuSign itself was unreachable for
 * longer than 30 seconds, or the request process was killed before the poll
 * finished. Those rows sit with `resolvedAt: null`, which is what
 * `voidLiveOfferEnvelopes` reads to refuse a recall or revision — silently,
 * forever, unless something eventually looks again.
 *
 * Two outcomes, and only one of them is safe to act on automatically:
 *
 *   NOT FOUND after a generous grace period — the send never reached
 *   DocuSign. Marking it resolved (`foundDocusignId: null`) is safe: nothing
 *   was ever out for the customer to sign, so recall/revision can proceed as
 *   normal on the estimator's next attempt.
 *
 *   FOUND — DocuSign has a live envelope this app has no other record of.
 *   That is exactly the state #321 exists to make visible, and the honest
 *   response is a human going to DocuSign to void it or finish recording it
 *   by hand — NOT this job quietly deciding what to do with a real signable
 *   document. So a found row stays unresolved (`resolvedAt` untouched) and
 *   keeps blocking; `foundDocusignId` and an `OfferStatusEvent` note are set
 *   once, so a person sees it, and the job does not re-alert on every run.
 */

// DocuSign create calls fail fast or succeed within seconds; the in-request
// poll already covers the first 30. A row younger than this has not had a
// fair chance to resolve on its own yet, so it is left for the next run
// rather than searched — searching too early just wastes API calls.
const MIN_ATTEMPT_AGE_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === "production") {
    if (!cronSecret) {
      console.error(
        "[CRON_ERROR] CRON_SECRET is not configured in production env.",
      );
      return errorResponse("Cron not configured", {
        status: 500,
        code: "CONFIG_ERROR",
      });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn(
        "[CRON_WARN] Unauthorized attempt to trigger reconcile-unconfirmed-envelope-sends cron.",
      );
      return errorResponse("Unauthorized", {
        status: 401,
        code: "UNAUTHORIZED",
      });
    }
  }

  const pending = await prisma.unconfirmedEnvelopeSend.findMany({
    where: {
      resolvedAt: null,
      attemptStartedAt: { lte: new Date(Date.now() - MIN_ATTEMPT_AGE_MS) },
    },
    select: {
      id: true,
      offerId: true,
      docType: true,
      sendAttemptId: true,
      attemptStartedAt: true,
      foundDocusignId: true,
      offer: { select: { offerStatus: true } },
    },
  });

  if (pending.length === 0) {
    return successResponse({ checked: 0, resolvedNotFound: 0, found: 0 });
  }

  let context: Awaited<ReturnType<typeof createDocusignContext>>;
  try {
    context = await createDocusignContext(getDocusignConfig());
  } catch (error) {
    // Cannot reach DocuSign this run — leave every row exactly as it is and
    // try again next time. Nothing here is urgent enough to guess at.
    console.error(
      "[cron] reconcile-unconfirmed-envelope-sends could not reach DocuSign:",
      error,
    );
    return errorResponse("Could not reach DocuSign", { status: 502 });
  }

  let resolvedNotFound = 0;
  let found = 0;

  for (const row of pending) {
    let envelopeId: string | null;
    try {
      envelopeId = await findEnvelopeIdBySendAttempt(
        context,
        row.sendAttemptId,
        row.attemptStartedAt,
      );
    } catch (error) {
      console.error(
        `[cron] reconcile-unconfirmed-envelope-sends failed to search for offer ${row.offerId}, attempt ${row.sendAttemptId}:`,
        error,
      );
      continue;
    }

    if (envelopeId === null) {
      await prisma.unconfirmedEnvelopeSend
        .update({
          where: { id: row.id },
          data: { resolvedAt: new Date() },
        })
        .then(() => {
          resolvedNotFound += 1;
        })
        .catch((updateError) =>
          console.error(
            `[cron] failed to resolve unconfirmed send ${row.id} as not-found:`,
            updateError,
          ),
        );
      continue;
    }

    found += 1;
    if (row.foundDocusignId === envelopeId) {
      // Already recorded on a previous run — do not alert twice.
      continue;
    }

    await prisma.unconfirmedEnvelopeSend
      .update({
        where: { id: row.id },
        // resolvedAt is deliberately NOT set: this keeps blocking recall and
        // revision until a person resolves it, which is the point.
        data: { foundDocusignId: envelopeId },
      })
      .catch((updateError) =>
        console.error(
          `[cron] failed to record the found envelope for unconfirmed send ${row.id}:`,
          updateError,
        ),
      );

    await prisma.offerStatusEvent
      .create({
        data: {
          offerId: row.offerId,
          fromStatus: row.offer.offerStatus,
          toStatus: row.offer.offerStatus,
          note: `DocuSign has a ${row.docType.toLowerCase()} envelope (${envelopeId}) this app has no other record of — a send timed out but reached DocuSign anyway. Open DocuSign, decide whether to void it or complete recording it, then resolve the pending send by hand.`,
        },
      })
      .catch((eventError) =>
        console.error(
          `[cron] failed to record the found-envelope activity note for offer ${row.offerId}:`,
          eventError,
        ),
      );
  }

  return successResponse({
    checked: pending.length,
    resolvedNotFound,
    found,
  });
}
