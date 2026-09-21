import { OutboxEventKind } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import type { BlobDeletePort } from "../ports/blob";
import { isBlobStorageUrl } from "@/lib/blob-url";

const EMAIL_ATTACHMENT_PREFIX = "/email-ad-hock-attachment-upload/";

export type EmailSendInput = {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
};

export type EmailSendPort = (input: EmailSendInput) => Promise<void>;

/** Authorize deletion of only the email composer’s own Blob namespace. */
export function authorizeEmailAttachmentDeletion(
  principal: DomainPrincipal,
  blobUrl: string,
): { blobUrl: string } {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Email attachment management requires internal staff access.",
    );
  }
  let pathname: string;
  try {
    const parsed = new URL(blobUrl);
    pathname = parsed.pathname;
  } catch {
    throw new DomainValidationError("The Blob URL is invalid.", "blobUrl");
  }
  if (
    !isBlobStorageUrl(blobUrl)
    || !pathname.startsWith(EMAIL_ATTACHMENT_PREFIX)
  ) {
    throw new DomainAuthorizationError(
      "Only an uploaded email attachment can be removed here.",
    );
  }
  return { blobUrl };
}

/**
 * Authorize and remove one composer attachment as a single command.
 *
 * The prefix rule is the only thing standing between this action and every
 * other object in the store — lead documents, offer PDFs, signed contracts —
 * so the delete belongs in the same call that applies it, not in an adapter
 * that could forget to act on the answer.
 */
export async function deleteEmailAttachment(
  principal: DomainPrincipal,
  blobUrl: string,
  deleteBlob: BlobDeletePort,
): Promise<{ blobUrl: string }> {
  const authorized = authorizeEmailAttachmentDeletion(principal, blobUrl);
  await deleteBlob(authorized.blobUrl);
  return authorized;
}

export type CampaignSendResult = {
  /** True when this call, or a previous one for the same intent, delivered. */
  readonly sent: boolean;
  /** True when the intent had already succeeded and nothing was re-sent. */
  readonly alreadySent: boolean;
};

/**
 * Send one campaign email to one recipient, behind a durable intent.
 *
 * A campaign is driven from the browser: the modal loops the selected leads in
 * batches and calls this once per lead. Nothing about that loop was durable —
 * a second click on Send, a retry after a timeout, or a reopened tab emailed
 * every lead in the list a second time. That is a customer-visible duplicate
 * from Royal's own mailbox, which is the expensive kind of mistake here.
 *
 * `runId` is generated once per Send click and combined with the recipient, so
 * one campaign reaches each lead once while a genuinely new campaign to the
 * same person still goes out. When a caller supplies no `runId` the send is
 * not deduplicated — the rule is opt-in, because inventing a key would make
 * every ad-hoc send look like a replay of the last one.
 */
export async function sendCampaignEmail(
  principal: DomainPrincipal,
  input: EmailSendInput & { readonly runId?: string },
  send: EmailSendPort,
  db?: DomainDb,
): Promise<CampaignSendResult> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Campaign email requires internal staff access.",
    );
  }
  const to = input.to.trim();
  if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
    throw new DomainValidationError(
      "A valid recipient email is required.",
      "to",
    );
  }

  const runId = input.runId?.trim();
  if (!runId || !db) {
    await send({ body: input.body, subject: input.subject, to });
    return { alreadySent: false, sent: true };
  }

  const { replayed } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `email-campaign:${runId}:${to.toLowerCase()}`,
      kind: OutboxEventKind.EMAIL_CAMPAIGN_SEND,
      payload: { runId, subject: input.subject, to },
    },
    async () => {
      await send({ body: input.body, subject: input.subject, to });
      return { to };
    },
  );
  return { alreadySent: replayed, sent: true };
}
