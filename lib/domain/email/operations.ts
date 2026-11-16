import { HistoryType, OutboxEventKind } from "@prisma/client";

import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { runOutboxEffect, runOutboxEffectWithOutcome } from "../outbox";
import {
  attributionUserId,
  isInternalPrincipal,
  type DomainPrincipal,
} from "../principal";
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
 *
 * `leadId` names the lead the email is for. When it is given, the send is also
 * written to that lead's history here, by the same server call that delivered
 * it. The modal used to build the entry and keep it in browser memory, so the
 * activity feed, the offer pre-fill and the agent never saw a campaign (#297),
 * and a tab closed between the send and a second request would have lost it.
 * A replay of an earlier send writes nothing: that first call recorded it.
 */
export async function sendCampaignEmail(
  principal: DomainPrincipal,
  input: EmailSendInput & {
    readonly leadId?: number;
    readonly runId?: string;
  },
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
    await recordCampaignHistory(principal, db, undefined, input);
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
  // Runs on a replay too. The history row has its own durable intent, so a
  // process that stopped after the email went out but before the row was
  // written, or a write that failed, is repaired by the retry; a row that was
  // written is not written twice.
  await recordCampaignHistory(principal, db, runId, input);
  return { alreadySent: replayed, sent: true };
}

/**
 * The email is already out, so a failed history write is logged and swallowed:
 * reporting the send as failed would invite a resend of a delivered email. With
 * a `runId` the write is its own outbox effect, keyed to the run and the lead,
 * which is what makes a retry safe: it repairs a missing row and never adds a
 * second one. Without one there is no run to key it to and no retry to repair.
 */
async function recordCampaignHistory(
  principal: DomainPrincipal,
  db: DomainDb | undefined,
  runId: string | undefined,
  input: { readonly leadId?: number; readonly subject: string },
): Promise<void> {
  const leadId = input.leadId;
  if (!db || leadId === undefined) return;
  const write = async () => {
    const authorId = attributionUserId(principal);
    await db.leadHistory.create({
      data: {
        action: "Email sent",
        actionDate: new Date(),
        detail: `Subject: ${input.subject}`,
        leadId,
        type: HistoryType.EMAIL,
        ...(authorId ? { authorId } : {}),
      },
    });
    return { leadId };
  };
  try {
    if (!runId) {
      await write();
      return;
    }
    await runOutboxEffectWithOutcome(
      db,
      {
        key: `email-campaign-history:${runId}:${leadId}`,
        kind: OutboxEventKind.EMAIL_CAMPAIGN_SEND,
        payload: { leadId, runId, subject: input.subject },
      },
      write,
      // A second run of an insert that committed but was not recorded as done
      // costs one duplicate activity row, which is the lesser harm than a
      // missing one.
      { repeatable: true },
    );
  } catch (error) {
    console.error(
      `[Campaign] Email to lead ${leadId} was sent but its history entry was not saved:`,
      error,
    );
  }
}
