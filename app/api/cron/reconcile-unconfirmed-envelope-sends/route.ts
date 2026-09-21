import prisma from "@/lib/prisma";
import { createDocusignContext } from "@/lib/docusign/client";
import { getDocusignConfig } from "@/lib/docusign/config";
import { findEnvelopeBySendAttempt } from "@/lib/docusign/envelope-send-attempt";
import { reconcileUnconfirmedSends } from "@/lib/domain/offers/send-reconciliation";
import type { EnvelopeSearchPort } from "@/lib/domain/ports/envelope-search";
import { domainErrorResponse } from "@/lib/http/domain-response";
import { successResponse, errorResponse } from "@/utils/validators";

/**
 * The backstop for a DocuSign send whose outcome the original request could
 * not confirm — see `UnconfirmedEnvelopeSend` and issue #321.
 *
 * Every decision this job makes lives in
 * `lib/domain/offers/send-reconciliation.ts`: which rows are eligible, that a
 * not-found may resolve a row only while nothing has recorded an envelope on
 * it, and that a FOUND row is deliberately left unresolved so it keeps
 * blocking recall and revision until a person deals with the live orphan. They
 * are business rules about a customer-facing document, not scheduling, and a
 * test can run them there.
 *
 * What is left here is the cron's own work: the shared secret, the DocuSign
 * context, and the response.
 */

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

  // The whole body, not just the DocuSign calls. A failure reading the pending
  // rows used to escape as an unhandled rejection, which Vercel surfaces as a
  // bare 500 with nothing naming the cron — and this job's whole purpose is
  // being noticed when something is wrong.
  try {
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

    const search: EnvelopeSearchPort = ({ sendAttemptId, since }) =>
      findEnvelopeBySendAttempt(context, sendAttemptId, since);

    const tally = await reconcileUnconfirmedSends(prisma, search);

    // Per-row failures are reported, not swallowed into a clean 200. A run
    // that searched nothing successfully should not read as a healthy run.
    if (tally.failed > 0) {
      return errorResponse(
        "Some unconfirmed envelope sends could not be reconciled",
        {
          status: 500,
          details: `checked=${tally.checked} resolvedNotFound=${tally.resolvedNotFound} found=${tally.found} incomplete=${tally.incomplete} failed=${tally.failed}`,
        },
      );
    }

    return successResponse({
      checked: tally.checked,
      resolvedNotFound: tally.resolvedNotFound,
      found: tally.found,
      incomplete: tally.incomplete,
    });
  } catch (error) {
    const refusal = domainErrorResponse(error);
    if (refusal) return refusal;

    console.error("[cron] reconcile-unconfirmed-envelope-sends failed:", error);
    return errorResponse("Failed to reconcile unconfirmed envelope sends", {
      status: 500,
    });
  }
}
