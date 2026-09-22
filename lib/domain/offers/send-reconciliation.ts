import type { DomainDb, TransactionalDomainDb } from "../db";
import type { EnvelopeSearchPort } from "../ports/envelope-search";

// The backstop for a DocuSign send whose outcome the original request could
// not confirm — `UnconfirmedEnvelopeSend`, issue #321.
//
// The primary reconcile attempt already happened in-request: a 30-second poll
// at the moment the create call failed. This is for the rows that outlive it —
// DocuSign unreachable for longer than that, or the request process killed
// before the poll finished. Those rows sit with `resolvedAt: null`, which is
// what `voidLiveOfferEnvelopes` reads to refuse a recall or a revision.
// Silently, and forever, unless something eventually looks again.
//
// It arrived on `staging` in PR #325 written straight into the cron handler,
// against the ambient Prisma client. The rules below are not scheduling
// concerns — which rows are eligible, what a not-found may safely do, why a
// found row must NOT be resolved — so they live here, take their database
// explicitly, and take the DocuSign search as a port. The handler keeps the
// cron secret, the provider context and the response shape.

/**
 * DocuSign create calls fail fast or succeed within seconds, and the
 * in-request poll already covers the first 30. A row younger than this has not
 * had a fair chance to resolve on its own, so searching it just spends API
 * calls on an answer that is not ready.
 */
export const MIN_ATTEMPT_AGE_MS = 5 * 60 * 1000;

/**
 * Each row costs at least one list call, plus one custom-fields call per
 * envelope that call returns. Bounded so a backlog cannot run out the
 * function's duration; the remainder waits for the next run, oldest first.
 */
export const RECONCILE_BATCH_LIMIT = 25;

export type ReconcilableSend = {
  readonly id: string;
  readonly offerId: string;
  readonly docType: string;
  readonly sendAttemptId: string;
  readonly attemptStartedAt: Date;
  readonly offer: { readonly offerStatus: string };
};

/**
 * The unresolved sends worth asking DocuSign about.
 *
 * `foundDocusignId: null` is not an optimisation. A row we already found an
 * envelope for stays unresolved on purpose, waiting on a person — and asking
 * again is unsafe, not merely wasteful: if a later search came back empty (the
 * envelope voided and fell outside the `listStatusChanges` window, a paginated
 * response, a transient blank) the not-found branch would resolve the row and
 * unblock a recall on an offer that really does have a live orphan.
 */
export async function listSendsToReconcile(
  db: DomainDb,
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<ReconcilableSend[]> {
  const now = options.now ?? new Date();
  return db.unconfirmedEnvelopeSend.findMany({
    orderBy: { attemptStartedAt: "asc" },
    select: {
      attemptStartedAt: true,
      docType: true,
      id: true,
      offer: { select: { offerStatus: true } },
      offerId: true,
      sendAttemptId: true,
    },
    take: options.limit ?? RECONCILE_BATCH_LIMIT,
    where: {
      attemptStartedAt: {
        lte: new Date(now.getTime() - MIN_ATTEMPT_AGE_MS),
      },
      foundDocusignId: null,
      resolvedAt: null,
    },
  });
}

/**
 * The send never reached DocuSign, so nothing is out for the customer to sign
 * and a recall may proceed. Answers whether this call was the one that
 * resolved it.
 *
 * `updateMany` with the full guard rather than `update` by id: the row was
 * read at the top of the run, and a concurrent run — or a person — may have
 * recorded a found envelope on it since. Resolving it then would unblock a
 * recall on an offer with a live orphan. A count of 0 means exactly that
 * happened, and the row is correctly left alone.
 */
export async function resolveSendAsNotFound(
  db: DomainDb,
  recordId: string,
): Promise<boolean> {
  const { count } = await db.unconfirmedEnvelopeSend.updateMany({
    data: { resolvedAt: new Date() },
    where: { foundDocusignId: null, id: recordId, resolvedAt: null },
  });
  return count > 0;
}

/**
 * DocuSign has a live envelope this app has no other record of.
 *
 * That is exactly the state #321 exists to make visible, and the honest
 * response is a person going to DocuSign to void it or finish recording it by
 * hand — not a scheduled job quietly deciding what to do with a real signable
 * document. So **`resolvedAt` is deliberately not set**: the row keeps
 * blocking recall and revision. `foundDocusignId` and one status-event note
 * are written so somebody sees it, and so the job does not re-alert every run.
 *
 * One transaction, because the mark and the alert are the same fact. As two
 * writes, a failed note would leave the row marked found — and the eligibility
 * query skips found rows, so the next run would never retry the alert. The row
 * would sit there blocking a recall with nothing anywhere saying why.
 *
 * The guard is `foundDocusignId: null` alone, deliberately NOT `resolvedAt:
 * null`, and it clears `resolvedAt`. **A found envelope always outranks a
 * concurrent "found nothing."** Two overlapping runs can read the same row and
 * get different answers from DocuSign — different windows, pagination, a
 * transient blank — and if the empty answer resolved the row first, requiring
 * `resolvedAt` to still be null here would silently drop the answer that
 * matters and leave a live orphan unblocked.
 *
 * Answers whether this call was the one that recorded it, so a caller counts a
 * row only once the transaction has committed.
 */
export async function recordFoundOrphanEnvelope(
  db: TransactionalDomainDb,
  input: {
    readonly recordId: string;
    readonly offerId: string;
    readonly docType: string;
    readonly envelopeId: string;
    readonly offerStatus: string;
  },
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const { count } = await tx.unconfirmedEnvelopeSend.updateMany({
      data: { foundDocusignId: input.envelopeId, resolvedAt: null },
      where: { foundDocusignId: null, id: input.recordId },
    });
    // Another run recorded the same envelope, and wrote the note with it.
    if (count === 0) return false;

    await tx.offerStatusEvent.create({
      data: {
        fromStatus: input.offerStatus as never,
        note: `DocuSign has a ${input.docType.toLowerCase()} envelope (${input.envelopeId}) this app has no other record of — a send timed out but reached DocuSign anyway. Open DocuSign, decide whether to void it or complete recording it, then resolve the pending send by hand.`,
        offerId: input.offerId,
        toStatus: input.offerStatus as never,
      },
    });
    return true;
  });
}

export type ReconcileTally = {
  readonly checked: number;
  readonly resolvedNotFound: number;
  readonly found: number;
  readonly incomplete: number;
  readonly failed: number;
};

/**
 * Work through the eligible rows and report what happened to each.
 *
 * Every per-row failure is counted rather than stepped over: a run that
 * searched nothing successfully must not read as a healthy run, and a database
 * failure leaves the row unresolved, so the run did not do what it would
 * otherwise report doing.
 */
export async function reconcileUnconfirmedSends(
  db: TransactionalDomainDb,
  search: EnvelopeSearchPort,
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<ReconcileTally> {
  const pending = await listSendsToReconcile(db, options);

  let resolvedNotFound = 0;
  let found = 0;
  let incomplete = 0;
  let failed = 0;

  for (const row of pending) {
    let result;
    try {
      result = await search({
        sendAttemptId: row.sendAttemptId,
        since: row.attemptStartedAt,
      });
    } catch (error) {
      failed += 1;
      console.error(
        `[offer] could not search for the envelope behind attempt ${row.sendAttemptId} (offer ${row.offerId}):`,
        error,
      );
      continue;
    }

    if (result.kind === "incomplete") {
      // The search could not reach the end of DocuSign's result set, so "no
      // match yet" is not the same as "no envelope". Resolving on that would
      // unblock a recall for an envelope on a page nobody read.
      incomplete += 1;
      console.warn(
        `[offer] the envelope search for offer ${row.offerId} did not complete: ${result.reason}`,
      );
      continue;
    }

    // The two database outcomes are counted separately rather than under one
    // catch. Either failure leaves the row unresolved, so the run did not do
    // what it would otherwise report doing — and naming which write failed is
    // the difference between "DocuSign is down" and "we cannot persist".
    if (result.kind === "not-found") {
      try {
        if (await resolveSendAsNotFound(db, row.id)) resolvedNotFound += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[offer] failed to resolve unconfirmed send ${row.id} as not-found:`,
          error,
        );
      }
      continue;
    }

    try {
      const recorded = await recordFoundOrphanEnvelope(db, {
        docType: row.docType,
        envelopeId: result.envelopeId,
        offerId: row.offerId,
        offerStatus: row.offer.offerStatus,
        recordId: row.id,
      });
      // Counted only once the transaction commits. Incremented before it, a
      // failed transaction still reported the row as found while leaving it
      // unmarked for the next run to retry.
      if (recorded) found += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[offer] failed to record the found envelope for unconfirmed send ${row.id} — left unmarked so the next run retries:`,
        error,
      );
    }
  }

  return { checked: pending.length, failed, found, incomplete, resolvedNotFound };
}
