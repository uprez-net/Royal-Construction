import docusign from "docusign-esign";
import type { DocusignContext } from "./client";

export const DOCUSIGN_SEND_ATTEMPT_FIELD = "rcSendAttempt";

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

/** Transport/timeouts: outcome is unknown — the envelope may still have been sent. */
export function isDocusignTransportFailure(error: unknown): boolean {
  const response = (error as { response?: { status?: number } }).response;
  if (response?.status !== undefined) {
    // A definitive HTTP response from DocuSign is not a transport failure.
    return false;
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

export async function findEnvelopeIdBySendAttempt(
  context: DocusignContext,
  sendAttemptId: string,
  since: Date,
): Promise<string | null> {
  const envelopesApi = new docusign.EnvelopesApi(context.apiClient);
  const fromDate = since.toISOString();
  const toDate = new Date().toISOString();

  const listed = await envelopesApi.listStatusChanges(context.accountId, {
    fromDate,
    toDate,
  });

  for (const summary of listed.envelopes ?? []) {
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
      return envelopeId;
    }
  }
  return null;
}

const RECONCILE_DELAYS_MS = [5_000, 10_000, 15_000];

export async function waitForEnvelopeBySendAttempt(
  context: DocusignContext,
  sendAttemptId: string,
  since: Date,
): Promise<string | null> {
  for (const delay of RECONCILE_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const envelopeId = await findEnvelopeIdBySendAttempt(
      context,
      sendAttemptId,
      since,
    );
    if (envelopeId) {
      return envelopeId;
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
    return {
      kind: "outcome-unknown",
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
