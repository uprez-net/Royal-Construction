import docusign from "docusign-esign";
import type { EnvelopeDocType, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { DocusignContext } from "./client";

export const DOCUSIGN_SEND_ATTEMPT_FIELD = "rcSendAttempt";

/**
 * Record that a send is about to happen, BEFORE calling DocuSign.
 *
 * The blocking record has to exist before the envelope can, or the protection
 * fails open. Written afterwards — in the catch, once the outcome is already
 * unknown — a failed write left no record at all: the operator was told not to
 * resend, but nothing stopped a recall from proceeding and a resend from
 * putting a second live document in front of the customer, which is the whole
 * thing this guards.
 *
 * Writing it first also covers the case no catch block can: the process dying
 * mid-send. The row simply stays unresolved and the reconcile cron picks it up.
 *
 * Returns null when the row could not be written, and the caller must then NOT
 * send. Refusing a send is recoverable; sending without the record is not.
 */
export async function beginEnvelopeSendAttempt(args: {
  readonly offerId: string;
  readonly docType: EnvelopeDocType;
  readonly sendAttemptId: string;
  readonly attemptStarted: Date;
}): Promise<string | null> {
  try {
    const { id } = await prisma.unconfirmedEnvelopeSend.create({
      data: {
        offerId: args.offerId,
        docType: args.docType,
        sendAttemptId: args.sendAttemptId,
        attemptStartedAt: args.attemptStarted,
      },
      select: { id: true },
    });
    return id;
  } catch (error) {
    console.error(
      `[offer] could not record a send attempt for offer ${args.offerId}; refusing to send without it:`,
      error,
    );
    return null;
  }
}

/**
 * Close a send attempt whose outcome is now known — the envelope was created
 * (so a real `Envelope` row blocks recall instead), or DocuSign definitively
 * rejected it (so nothing is out there).
 *
 * Only an outcome that stays unknown leaves the row unresolved, which is what
 * makes a recall refuse.
 *
 * Takes an optional transaction client so the success path can resolve the
 * attempt in the same transaction that writes the Envelope row: the record
 * must not be cleared unless the row that replaces it commits.
 */
export async function resolveEnvelopeSendAttempt(
  recordId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await db.unconfirmedEnvelopeSend.updateMany({
    where: { id: recordId, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
}

export function attachSendAttemptCustomField(
  envelopeDefinition: docusign.EnvelopeDefinition,
  sendAttemptId: string,
): void {
  envelopeDefinition.customFields = {
    textCustomFields: [
      {
        name: DOCUSIGN_SEND_ATTEMPT_FIELD,
        value: sendAttemptId,
        required: "false",
        show: "false",
      },
    ],
  };
}

export function describeDocusignError(error: unknown): string {
  const response = (error as { response?: { body?: unknown } }).response;
  if (response?.body) {
    const body = response.body as { errorCode?: string; message?: string };
    if (body.message) {
      return body.errorCode
        ? `${body.errorCode}: ${body.message}`
        : body.message;
    }
  }
  return (error as Error).message ?? "Unknown error";
}

/**
 * The outcome is unknown — DocuSign may still have created and emailed the
 * envelope — so the caller must reconcile rather than release its claim.
 *
 * "Did a response arrive at all" is the primary test, but it is not sufficient
 * on its own. A 5xx is a response, and DocuSign can return one AFTER creating
 * the envelope; treating that as a definitive rejection releases the claim and
 * lets a retry create a second legal envelope. Only a 4xx genuinely says the
 * request was understood and refused.
 */
export function isDocusignTransportFailure(error: unknown): boolean {
  const response = (error as { response?: { status?: number } }).response;
  const status = response?.status;
  if (status !== undefined) {
    // 5xx (and anything outside the 4xx client-error band) leaves the outcome
    // open: the request reached DocuSign and may have been acted on before it
    // failed. 4xx is a refusal we can trust.
    return !(status >= 400 && status < 500);
  }
  const code = (error as { code?: string }).code;
  if (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  const message = describeDocusignError(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("network error") ||
    message.includes("socket hang up")
  );
}

/**
 * The outcome of looking for an envelope by its send-attempt marker.
 *
 * "not-found" and "incomplete" have to be different answers. `listStatusChanges`
 * is paginated, and reading only the first page and reporting null is a false
 * negative — which the reconcile cron would act on by resolving the attempt and
 * unblocking a recall, on an offer whose envelope is simply on page two. Only a
 * search that reached the end of the result set may say "not-found".
 */
export type EnvelopeSearchResult =
  | { readonly kind: "found"; readonly envelopeId: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "incomplete"; readonly reason: string };

// DocuSign caps a page well below this; the cap is here so a very wide window
// cannot spin forever, and hitting it reports "incomplete" rather than lying.
const MAX_SEARCH_PAGES = 20;
const SEARCH_PAGE_SIZE = 100;

export async function findEnvelopeBySendAttempt(
  context: DocusignContext,
  sendAttemptId: string,
  since: Date,
): Promise<EnvelopeSearchResult> {
  const envelopesApi = new docusign.EnvelopesApi(context.apiClient);
  const fromDate = since.toISOString();
  const toDate = new Date().toISOString();

  let startPosition = 0;
  for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
    const listed = await envelopesApi.listStatusChanges(context.accountId, {
      fromDate,
      toDate,
      startPosition: String(startPosition),
      count: String(SEARCH_PAGE_SIZE),
    });

    const envelopes = listed.envelopes ?? [];
    for (const summary of envelopes) {
      const envelopeId = summary.envelopeId;
      if (!envelopeId) continue;
      const fields = await envelopesApi.listCustomFields(
        context.accountId,
        envelopeId,
      );
      const match = fields.textCustomFields?.find(
        (field) =>
          field.name === DOCUSIGN_SEND_ATTEMPT_FIELD &&
          field.value === sendAttemptId,
      );
      if (match) {
        return { kind: "found", envelopeId };
      }
    }

    // Walk on only while there is demonstrably more to read. Every branch that
    // stops has to be sure it stopped at the END of the result set — stopping
    // early and reporting "not-found" is the false negative this type exists
    // to prevent.
    const returned = envelopes.length;
    const total = Number(listed.totalSetSize);
    const endPosition = Number(listed.endPosition);
    startPosition = Number.isFinite(endPosition)
      ? endPosition + 1
      : startPosition + returned;

    if (returned === 0) {
      // An empty page is not proof of the end. DocuSign can return one while
      // the total still says there is more to come, and calling that
      // "not-found" lets the cron resolve the attempt and unblock a recall
      // with a matching envelope still further down the result set.
      if (Number.isFinite(total) && startPosition < total) {
        return {
          kind: "incomplete",
          reason: `DocuSign returned an empty page at ${startPosition} of ${total}`,
        };
      }
      return { kind: "not-found" };
    }
    if (Number.isFinite(total)) {
      if (startPosition >= total) {
        return { kind: "not-found" };
      }
    } else if (returned < SEARCH_PAGE_SIZE) {
      // No totalSetSize to compare against, but a short page is the last page.
      return { kind: "not-found" };
    }
  }

  return {
    kind: "incomplete",
    reason: `more than ${MAX_SEARCH_PAGES} pages of envelope status changes since ${fromDate}`,
  };
}

const RECONCILE_DELAYS_MS = [5_000, 10_000, 15_000];

export async function waitForEnvelopeBySendAttempt(
  context: DocusignContext,
  sendAttemptId: string,
  since: Date,
): Promise<string | null> {
  for (const delay of RECONCILE_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const found = await findEnvelopeBySendAttempt(
      context,
      sendAttemptId,
      since,
    );
    if (found.kind === "found") {
      return found.envelopeId;
    }
  }
  return null;
}

export type EnvelopeCreateRecovery =
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "reconciled"; readonly envelopeId: string }
  | { readonly kind: "outcome-unknown"; readonly reason: string };

export async function resolveEnvelopeCreateError(args: {
  readonly error: unknown;
  readonly context: DocusignContext | null;
  readonly sendAttemptId: string;
  readonly attemptStarted: Date;
}): Promise<EnvelopeCreateRecovery> {
  if (!isDocusignTransportFailure(args.error)) {
    return {
      kind: "rejected",
      reason: describeDocusignError(args.error),
    };
  }
  if (!args.context) {
    // No context means createDocusignContext itself failed, so no create
    // request was ever made and nothing can be out for signature. Calling that
    // "unknown" kept the *_SENT claim and left the offer stuck: no envelope to
    // find, no way to retry, and a trip to DocuSign that would show nothing.
    // A rejection releases the claim, which is the honest answer.
    return {
      kind: "rejected",
      reason: describeDocusignError(args.error),
    };
  }
  const envelopeId = await waitForEnvelopeBySendAttempt(
    args.context,
    args.sendAttemptId,
    args.attemptStarted,
  );
  if (envelopeId) {
    return { kind: "reconciled", envelopeId };
  }
  return {
    kind: "outcome-unknown",
    reason: describeDocusignError(args.error),
  };
}
