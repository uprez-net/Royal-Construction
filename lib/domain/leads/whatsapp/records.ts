import type {
  Prisma,
  WhatsAppMessageDirection,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
} from "@prisma/client";

import type { DomainDb } from "../../db";
import { attributionUserId, type DomainPrincipal } from "../../principal";

// The shapes every WhatsApp command and query hands back, and the one history
// writer they share. Typed domain records, not view models: the modal and Eve
// both shape these for themselves.

export const WHATSAPP_MESSAGE_SELECT = {
  author: { select: { name: true } },
  body: true,
  conversation: {
    select: {
      businessDisplayNumber: true,
      businessPhoneNumberId: true,
      customerPhoneE164: true,
    },
  },
  conversationId: true,
  deliveredAt: true,
  direction: true,
  failedAt: true,
  id: true,
  kind: true,
  leadId: true,
  needsReconciliation: true,
  occurredAt: true,
  providerErrorCode: true,
  providerErrorTitle: true,
  readAt: true,
  status: true,
  statusAt: true,
  templateName: true,
} satisfies Prisma.LeadWhatsAppMessageSelect;

type RawMessage = Prisma.LeadWhatsAppMessageGetPayload<{
  select: typeof WHATSAPP_MESSAGE_SELECT;
}>;

export type LeadWhatsAppMessageRecord = {
  readonly id: string;
  readonly leadId: number;
  readonly conversationId: string;
  readonly direction: WhatsAppMessageDirection;
  readonly kind: WhatsAppMessageKind;
  readonly body: string;
  readonly templateName: string | null;
  readonly status: WhatsAppMessageStatus;
  readonly statusAt: Date;
  readonly occurredAt: Date;
  readonly deliveredAt: Date | null;
  readonly readAt: Date | null;
  readonly failedAt: Date | null;
  readonly providerErrorCode: string | null;
  readonly providerErrorTitle: string | null;
  readonly needsReconciliation: boolean;
  readonly businessPhoneNumberId: string;
  readonly businessDisplayNumber: string;
  readonly customerPhoneE164: string;
  /** The staff member who sent it; null for inbound and unattributed sends. */
  readonly authorName: string | null;
};

export function toWhatsAppMessageRecord(
  row: RawMessage,
): LeadWhatsAppMessageRecord {
  return {
    authorName: row.author?.name ?? null,
    body: row.body,
    businessDisplayNumber: row.conversation.businessDisplayNumber,
    businessPhoneNumberId: row.conversation.businessPhoneNumberId,
    conversationId: row.conversationId,
    customerPhoneE164: row.conversation.customerPhoneE164,
    deliveredAt: row.deliveredAt,
    direction: row.direction,
    failedAt: row.failedAt,
    id: row.id,
    kind: row.kind,
    leadId: row.leadId,
    needsReconciliation: row.needsReconciliation,
    occurredAt: row.occurredAt,
    providerErrorCode: row.providerErrorCode,
    providerErrorTitle: row.providerErrorTitle,
    readAt: row.readAt,
    status: row.status,
    statusAt: row.statusAt,
    templateName: row.templateName,
  };
}

/**
 * Record that a WhatsApp message happened, without its body.
 *
 * The issue is explicit that the body is not duplicated into other business
 * records: it lives on LeadWhatsAppMessage, and the history row says who, when
 * and which number — enough to find it, and to show up in the lead's feed and
 * searches alongside email and calls.
 *
 * Not caught. Every caller runs this inside the transaction that wrote the
 * message, so the history and the message commit or roll back together.
 */
export async function recordWhatsAppHistory(
  db: DomainDb,
  entry: {
    readonly leadId: number;
    readonly action: string;
    readonly detail: string;
    readonly at: Date;
    readonly principal: DomainPrincipal;
  },
): Promise<void> {
  const authorId = attributionUserId(entry.principal);
  await db.leadHistory.create({
    data: {
      action: entry.action,
      actionDate: entry.at,
      detail: entry.detail,
      leadId: entry.leadId,
      type: "WHATSAPP",
      ...(authorId ? { authorId } : {}),
    },
  });
}

/** Prisma's unique-constraint violation, without importing its runtime. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && (error as { code?: unknown }).code === "P2002"
  );
}
