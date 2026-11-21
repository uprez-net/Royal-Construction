import {
  OutboxEventKind,
  OutboxEventStatus,
  ProjectWhatsAppGroupStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
} from "@prisma/client";

import { authorizeProjectRecording } from "../../access/projects";
import type { TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../../errors";
import {
  claimOutboxEvent,
  completeOutboxEvent,
  enqueueOutboxEvent,
  failOutboxEvent,
} from "../../outbox";
import { isWhatsAppSendError } from "../../ports/whatsapp";
import type {
  WhatsAppBridgePort,
  WhatsAppBridgeSendReceipt,
} from "../../ports/whatsapp-bridge";
import {
  attributionUserId,
  isInternalPrincipal,
  type DomainPrincipal,
} from "../../principal";
import { MAX_WHATSAPP_TEXT_LENGTH } from "../../leads/whatsapp/policy";
import { applyPendingWhatsAppStatuses } from "../../leads/whatsapp/status";
import { projectWhatsAppGroupAvailability } from "./group-shared";
import {
  PROJECT_WHATSAPP_MESSAGE_SELECT,
  toProjectWhatsAppMessageRecord,
  type ProjectWhatsAppMessageRecord,
} from "./records";

// Sending a message into a project's WhatsApp group.
//
// The same discipline as a lead's send (lib/domain/leads/whatsapp/send.ts),
// because the same thing is at stake — a message on a client's phone that
// cannot be taken back:
//
//   - the caller's idempotency key names the intent; none is derived here;
//   - the message row and its outbox intent are written before the bridge is called;
//   - a definite refusal marks it FAILED and re-opens the intent, so pressing
//     Send again with the same key is a genuine retry;
//   - an ambiguous failure is flagged for a person and never retried;
//   - a replay of a key that already sent answers `alreadySent: true`.
//
// What differs is the gate, and the channel. Everyone in the group joined it
// themselves or was added by the office, so there is no per-person consent or
// customer-service window to check — only that the group is linked and live.
// It goes out through Royal's WhatsApp bridge (ports/whatsapp-bridge.ts), with
// the outbox key as the bridge's own Idempotency-Key: a retry the bridge has
// already sent answers with the first message instead of posting twice.

export type SendProjectWhatsAppInput = {
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly body: string;
  readonly now?: Date;
};

export type SendProjectWhatsAppResult = {
  readonly message: ProjectWhatsAppMessageRecord;
  readonly alreadySent: boolean;
};

const MAX_KEY_LENGTH = 200;
const STALE_SEND_LOCK_MS = 60_000;

const AMBIGUOUS_SEND_MESSAGE =
  "WhatsApp didn't confirm whether the message reached the group, so it has not been retried. Check the group on the business phone, then mark the message sent or not sent before sending again.";

export function projectWhatsAppOutboxKey(projectId: string, key: string) {
  return `project-whatsapp:${projectId}:${key}`;
}

function requireStaff(principal: DomainPrincipal) {
  if (!isInternalPrincipal(principal) || principal.kind !== "user") {
    throw new DomainAuthorizationError(
      "Sending to a project's WhatsApp group requires a signed-in member of staff.",
    );
  }
  return principal;
}

export async function sendProjectWhatsAppMessage(
  principal: DomainPrincipal,
  input: SendProjectWhatsAppInput,
  db: TransactionalDomainDb,
  ports: { readonly bridge?: WhatsAppBridgePort | null } = {},
): Promise<SendProjectWhatsAppResult> {
  requireStaff(principal);
  const now = input.now ?? new Date();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > MAX_KEY_LENGTH) {
    throw new DomainValidationError(
      "A send needs an idempotency key so a retry cannot message the group twice.",
      "idempotencyKey",
    );
  }
  const project = await authorizeProjectRecording(
    principal,
    input.projectId,
    db,
  );
  const outboxKey = projectWhatsAppOutboxKey(project.id, idempotencyKey);

  const prior = await db.projectWhatsAppMessage.findUnique({
    select: PROJECT_WHATSAPP_MESSAGE_SELECT,
    where: { idempotencyKey: outboxKey },
  });
  if (prior) {
    if (prior.needsReconciliation) {
      throw new DomainTransitionError(
        "This message may already be in the group — WhatsApp never confirmed it. Check the group and mark it sent or not sent before sending again.",
      );
    }
    if (
      prior.status !== WhatsAppMessageStatus.QUEUED
      && prior.status !== WhatsAppMessageStatus.FAILED
    ) {
      return {
        alreadySent: true,
        message: toProjectWhatsAppMessageRecord(prior),
      };
    }
  }

  const body = input.body.trim();
  if (!body) throw new DomainValidationError("Write a message first.", "body");
  if (body.length > MAX_WHATSAPP_TEXT_LENGTH) {
    throw new DomainValidationError(
      `A WhatsApp message can be at most ${MAX_WHATSAPP_TEXT_LENGTH} characters.`,
      "body",
    );
  }

  const bridge = ports.bridge ?? null;
  const availability = projectWhatsAppGroupAvailability(bridge);
  if (!bridge || !availability.available) {
    throw new DomainSideEffectError(
      availability.reason
        ?? "WhatsApp isn't reachable from here, so nothing was sent.",
      "whatsapp",
      false,
    );
  }

  const group = await db.projectWhatsAppGroup.findUnique({
    select: {
      id: true,
      providerGroupId: true,
      status: true,
    },
    where: { projectId: project.id },
  });
  if (!group) {
    throw new DomainTransitionError(
      "This project has no WhatsApp group yet. Create or link one first.",
    );
  }
  if (
    group.status !== ProjectWhatsAppGroupStatus.ACTIVE
    || !group.providerGroupId
  ) {
    throw new DomainTransitionError(
      group.status === ProjectWhatsAppGroupStatus.CREATING
        ? "The group is still being created. Try again once it shows as ready."
        : "This project's WhatsApp group isn't linked any more. Create or link one.",
    );
  }
  const providerGroupId = group.providerGroupId;

  const prepared = await db.$transaction(async (tx) => {
    const intent = await enqueueOutboxEvent(tx, {
      key: outboxKey,
      kind: OutboxEventKind.PROJECT_WHATSAPP_SEND,
      payload: {
        groupId: providerGroupId,
        projectId: project.id,
      },
    });
    if (intent.status === OutboxEventStatus.SUCCEEDED) {
      return { replay: true as const, stale: false as const };
    }
    if (intent.status === OutboxEventStatus.RUNNING) {
      const running = await tx.outboxEvent.findUnique({
        select: { lockedAt: true },
        where: { id: intent.id },
      });
      const lockedFor = running?.lockedAt
        ? now.getTime() - running.lockedAt.getTime()
        : 0;
      if (lockedFor <= STALE_SEND_LOCK_MS) {
        throw new DomainTransitionError(
          "This message is already being sent. Wait for it to finish before trying again.",
        );
      }
      await failOutboxEvent(tx, intent.id, {
        message:
          "The send attempt stopped before WhatsApp's answer was recorded; it may have been delivered.",
        retryable: false,
      });
      await tx.projectWhatsAppMessage.updateMany({
        data: {
          needsReconciliation: true,
          providerErrorTitle:
            "WhatsApp did not confirm this send. Check the group before sending again.",
        },
        where: { idempotencyKey: outboxKey },
      });
      return { replay: false as const, stale: true as const };
    }
    if (intent.status === OutboxEventStatus.FAILED) {
      throw new DomainTransitionError(
        `This message was already attempted and needs reconciliation before retrying (outbox key ${outboxKey}).`,
      );
    }

    const fields = {
      body,
      failedAt: null,
      kind: WhatsAppMessageKind.TEXT,
      occurredAt: now,
      providerErrorCode: null,
      providerErrorTitle: null,
      status: WhatsAppMessageStatus.QUEUED,
      statusAt: now,
    };
    const message = await tx.projectWhatsAppMessage.upsert({
      create: {
        ...fields,
        authorId: attributionUserId(principal),
        direction: WhatsAppMessageDirection.OUTBOUND,
        groupId: group.id,
        idempotencyKey: outboxKey,
        projectId: project.id,
      },
      select: { id: true },
      update: fields,
      where: { idempotencyKey: outboxKey },
    });
    return {
      messageId: message.id,
      replay: false as const,
      stale: false as const,
    };
  });

  if (prepared.stale) {
    throw new DomainSideEffectError(AMBIGUOUS_SEND_MESSAGE, "whatsapp", false);
  }
  if (prepared.replay) {
    const stored = await db.projectWhatsAppMessage.findUnique({
      select: PROJECT_WHATSAPP_MESSAGE_SELECT,
      where: { idempotencyKey: outboxKey },
    });
    if (!stored) {
      throw new DomainTransitionError(
        `This send is recorded as complete but its message is missing (outbox key ${outboxKey}). Reconcile it before retrying.`,
      );
    }
    return {
      alreadySent: true,
      message: toProjectWhatsAppMessageRecord(stored),
    };
  }

  const claimed = await claimOutboxEvent(db, outboxKey);
  if (!claimed) {
    throw new DomainTransitionError(
      "This message is already being sent. Wait for it to finish before trying again.",
    );
  }

  let receipt: WhatsAppBridgeSendReceipt;
  try {
    receipt = await bridge.sendText({
      groupJid: providerGroupId,
      idempotencyKey: outboxKey,
      text: body,
    });
  } catch (error) {
    const sendError = isWhatsAppSendError(error) ? error : null;
    const definite = sendError?.outcome === "not_sent";
    const failedAt = new Date();
    await db.$transaction(async (tx) => {
      await failOutboxEvent(tx, claimed.id, {
        message: definite
          ? "WhatsApp refused the message or could not be reached; nothing was delivered."
          : "WhatsApp did not confirm the send; it may have been delivered.",
        retryable: definite,
      });
      await tx.projectWhatsAppMessage.update({
        data: definite
          ? {
              failedAt,
              providerErrorCode: sendError?.details.code ?? null,
              providerErrorTitle: sendError?.message ?? null,
              status: WhatsAppMessageStatus.FAILED,
              statusAt: failedAt,
            }
          : {
              needsReconciliation: true,
              providerErrorTitle:
                "WhatsApp did not confirm this send. Check the group before sending again.",
            },
        where: { id: prepared.messageId },
      });
    });
    if (definite) {
      throw new DomainSideEffectError(
        `Nothing was sent: ${sendError?.message ?? "WhatsApp refused the message."}`,
        "whatsapp",
        true,
        { cause: error },
      );
    }
    throw new DomainSideEffectError(AMBIGUOUS_SEND_MESSAGE, "whatsapp", false, {
      cause: error,
    });
  }

  const sentAt = new Date();
  await db.$transaction(async (tx) => {
    await completeOutboxEvent(tx, claimed.id, {
      messageId: prepared.messageId,
      providerMessageId: receipt.messageId,
      replayedByBridge: receipt.replayed,
    });
    await tx.projectWhatsAppMessage.update({
      data: {
        occurredAt: sentAt,
        providerMessageId: receipt.messageId,
        status: WhatsAppMessageStatus.SENT,
        statusAt: sentAt,
      },
      where: { id: prepared.messageId },
    });
    await tx.projectWhatsAppGroup.update({
      data: { lastMessageAt: sentAt },
      where: { id: group.id },
    });
    await applyPendingWhatsAppStatuses(receipt.messageId, tx);
  });

  const current = await db.projectWhatsAppMessage.findUniqueOrThrow({
    select: PROJECT_WHATSAPP_MESSAGE_SELECT,
    where: { id: prepared.messageId },
  });
  return {
    alreadySent: false,
    message: toProjectWhatsAppMessageRecord(current),
  };
}

/**
 * Settle a group send WhatsApp never confirmed: a person checked the group on
 * the business phone and says what happened.
 */
export async function reconcileProjectWhatsAppMessage(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly messageId: string;
    readonly outcome: "sent" | "not_sent";
  },
  db: TransactionalDomainDb,
): Promise<ProjectWhatsAppMessageRecord> {
  requireStaff(principal);
  await authorizeProjectRecording(principal, input.projectId, db);
  const message = await db.projectWhatsAppMessage.findUnique({
    select: {
      direction: true,
      groupId: true,
      id: true,
      needsReconciliation: true,
      projectId: true,
    },
    where: { id: input.messageId },
  });
  if (!message || message.projectId !== input.projectId) {
    throw new DomainNotFoundError("Message not found");
  }
  if (
    message.direction !== WhatsAppMessageDirection.OUTBOUND
    || !message.needsReconciliation
  ) {
    throw new DomainTransitionError("This message doesn't need reconciling.");
  }
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.projectWhatsAppMessage.update({
      data:
        input.outcome === "sent"
          ? {
              needsReconciliation: false,
              providerErrorTitle:
                "Confirmed sent by staff after checking WhatsApp.",
              status: WhatsAppMessageStatus.SENT,
              statusAt: now,
            }
          : {
              failedAt: now,
              needsReconciliation: false,
              providerErrorTitle:
                "Confirmed not sent by staff after checking WhatsApp.",
              status: WhatsAppMessageStatus.FAILED,
              statusAt: now,
            },
      select: PROJECT_WHATSAPP_MESSAGE_SELECT,
      where: { id: message.id },
    });
    if (input.outcome === "sent") {
      await tx.projectWhatsAppGroup.update({
        data: { lastMessageAt: now },
        where: { id: message.groupId },
      });
    }
    return toProjectWhatsAppMessageRecord(updated);
  });
}
