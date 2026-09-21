import prisma from "@/lib/prisma";
import { successResponse, errorResponse } from "@/utils/validators";
import { createDocusignContext } from "@/lib/docusign/client";
import { getDocusignConfig } from "@/lib/docusign/config";
import { findEnvelopeBySendAttempt } from "@/lib/docusign/envelope-send-attempt";

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

// Each row costs at least one DocuSign list call, and more for every envelope
// that call returns. Bounded so a backlog cannot run out the function's
// duration; the remainder waits for the next run, oldest first.
const RECONCILE_BATCH_LIMIT = 25;

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

  // The whole body, not just the DocuSign calls. A failure reading the
  // pending rows used to escape as an unhandled rejection, which Vercel
  // surfaces as a bare 500 with nothing naming the cron — and this job's
  // whole purpose is being noticed when something is wrong.
  try {
    const pending = await prisma.unconfirmedEnvelopeSend.findMany({
      where: {
        resolvedAt: null,
        // Never re-search a row we already found an envelope for. Those stay
        // unresolved on purpose, waiting on a person — but asking DocuSign about
        // them again is not just wasted calls, it is unsafe: if a later search
        // came back empty (the envelope voided and fell outside the
        // listStatusChanges window, a paginated response, a transient blank)
        // the not-found branch below would mark the row resolved and unblock a
        // recall on an offer that really does have a live orphan envelope.
        foundDocusignId: null,
        attemptStartedAt: { lte: new Date(Date.now() - MIN_ATTEMPT_AGE_MS) },
      },
      select: {
        id: true,
        offerId: true,
        docType: true,
        sendAttemptId: true,
        attemptStartedAt: true,
        offer: { select: { offerStatus: true } },
      },
      // Oldest first, and bounded: each row costs a listStatusChanges call plus
      // a listCustomFields call per envelope it returns, so an unbounded backlog
      // could run out the function's duration and leave the tail unprocessed.
      // Whatever this run does not reach is picked up by the next one.
      orderBy: { attemptStartedAt: "asc" },
      take: RECONCILE_BATCH_LIMIT,
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
    let incomplete = 0;
    let failed = 0;

    for (const row of pending) {
      let search: Awaited<ReturnType<typeof findEnvelopeBySendAttempt>>;
      try {
        search = await findEnvelopeBySendAttempt(
          context,
          row.sendAttemptId,
          row.attemptStartedAt,
        );
      } catch (error) {
        failed += 1;
        console.error(
          `[cron] reconcile-unconfirmed-envelope-sends failed to search for offer ${row.offerId}, attempt ${row.sendAttemptId}:`,
          error,
        );
        continue;
      }

      if (search.kind === "incomplete") {
        // The search could not reach the end of DocuSign's result set, so
        // "no match yet" is not the same as "no envelope". Resolving on that
        // would unblock a recall for an envelope sitting on a page we never
        // read. Left for the next run.
        incomplete += 1;
        console.warn(
          `[cron] reconcile-unconfirmed-envelope-sends could not complete the search for offer ${row.offerId}: ${search.reason}`,
        );
        continue;
      }

      if (search.kind === "not-found") {
        // updateMany with the full guard rather than update by id: the row was
        // read at the top of this run, and a concurrent run (or a person) may
        // have recorded a found envelope on it since. Resolving it then would
        // unblock a recall on an offer with a live orphan. A count of 0 means
        // exactly that happened, and the row is correctly left alone.
        await prisma.unconfirmedEnvelopeSend
          .updateMany({
            where: { id: row.id, resolvedAt: null, foundDocusignId: null },
            data: { resolvedAt: new Date() },
          })
          .then(({ count }) => {
            if (count > 0) {
              resolvedNotFound += 1;
            }
          })
          .catch((updateError) => {
            // Counted, not just logged: the row is still unresolved, so the
            // run did not do what it reports doing.
            failed += 1;
            console.error(
              `[cron] failed to resolve unconfirmed send ${row.id} as not-found:`,
              updateError,
            );
          });
        continue;
      }

      const envelopeId = search.envelopeId;

      // One transaction, because the mark and the alert are the same fact. Done
      // as two writes, a failed note would leave the row marked found — and the
      // query above skips found rows, so the next run would never retry the
      // alert. The row would sit there blocking a recall with nothing anywhere
      // telling a person why. Failing the whole thing instead leaves the row
      // untouched and the next run tries again.
      //
      // resolvedAt is deliberately NOT set: a found envelope keeps blocking
      // recall and revision until a person deals with it, which is the point.
      // The guard makes the write idempotent against a concurrent run.
      try {
        const recorded = await prisma.$transaction(async (tx) => {
          const { count } = await tx.unconfirmedEnvelopeSend.updateMany({
            // Deliberately NOT guarded on `resolvedAt: null`, and it clears
            // resolvedAt below. Finding a real envelope always wins over a
            // concurrent run that found nothing: two overlapping runs can read
            // the same row and get different answers from DocuSign (different
            // listStatusChanges windows, pagination, a transient blank), and if
            // the empty answer resolved the row first, requiring resolvedAt to
            // still be null here would silently drop the answer that matters and
            // leave a live orphan unblocked. `foundDocusignId: null` alone keeps
            // it idempotent — the second finder writes nothing and adds no
            // duplicate note.
            where: { id: row.id, foundDocusignId: null },
            data: { foundDocusignId: envelopeId, resolvedAt: null },
          });
          if (count === 0) {
            // Another run recorded the same envelope, and wrote the note with it.
            return false;
          }
          await tx.offerStatusEvent.create({
            data: {
              offerId: row.offerId,
              fromStatus: row.offer.offerStatus,
              toStatus: row.offer.offerStatus,
              note: `DocuSign has a ${row.docType.toLowerCase()} envelope (${envelopeId}) this app has no other record of — a send timed out but reached DocuSign anyway. Open DocuSign, decide whether to void it or complete recording it, then resolve the pending send by hand.`,
            },
          });
          return true;
        });
        if (recorded) {
          // Counted only once the transaction commits. Incremented before it,
          // a failed transaction still reported the row as found while leaving
          // it unmarked for the next run to retry.
          found += 1;
        }
      } catch (recordError) {
        failed += 1;
        console.error(
          `[cron] failed to record the found envelope for unconfirmed send ${row.id} — left unmarked so the next run retries:`,
          recordError,
        );
      }
    }

    // Per-row failures are reported, not swallowed into a clean 200. A run
    // that searched nothing successfully should not read as a healthy run.
    if (failed > 0) {
      return errorResponse(
        "Some unconfirmed envelope sends could not be reconciled",
        {
          status: 500,
          details: `checked=${pending.length} resolvedNotFound=${resolvedNotFound} found=${found} incomplete=${incomplete} failed=${failed}`,
        },
      );
    }
    return successResponse({
      checked: pending.length,
      resolvedNotFound,
      found,
      incomplete,
    });
  } catch (error) {
    console.error("[cron] reconcile-unconfirmed-envelope-sends failed:", error);
    return errorResponse("Failed to reconcile unconfirmed envelope sends", {
      status: 500,
    });
  }
}
