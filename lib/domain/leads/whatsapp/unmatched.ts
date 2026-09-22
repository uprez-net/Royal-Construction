import {
  WhatsAppUnmatchedStatus,
  type WhatsAppMessageKind,
  type WhatsAppUnmatchedReason,
} from "@prisma/client";

import { authorizeLead } from "../../access/leads";
import type { DomainDb, TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainTransitionError,
} from "../../errors";
import type { WhatsAppChannel } from "../../ports/whatsapp";
import {
  isInternalPrincipal,
  type DomainPrincipal,
  type UserPrincipal,
} from "../../principal";
import { attachInbound } from "./inbound";
import { isUniqueViolation } from "./records";

// The review queue for inbound messages no single lead owns (issue #333).
//
// A person decides. Attaching files the message on the chosen lead exactly as
// the webhook would have (same conversation, window and unread effects);
// dismissing keeps the row, marked, so "we looked at it" is on record.

export type UnmatchedWhatsAppRecord = {
  readonly id: string;
  readonly fromPhoneE164: string;
  readonly profileName: string | null;
  readonly businessPhoneNumberId: string;
  readonly businessLabel: string | null;
  readonly kind: WhatsAppMessageKind;
  readonly body: string;
  readonly reason: WhatsAppUnmatchedReason;
  readonly receivedAt: Date;
  readonly status: WhatsAppUnmatchedStatus;
  readonly candidates: readonly { id: number; name: string }[];
};

function requireStaff(principal: DomainPrincipal): UserPrincipal {
  if (principal.kind !== "user" || !isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Reviewing WhatsApp messages requires a signed-in member of staff.",
    );
  }
  return principal;
}

export async function listUnmatchedWhatsAppMessages(
  principal: DomainPrincipal,
  input: { readonly status?: WhatsAppUnmatchedStatus; readonly limit?: number },
  db: DomainDb,
  context: { readonly channel: WhatsAppChannel | null },
): Promise<{ items: UnmatchedWhatsAppRecord[]; pendingCount: number }> {
  requireStaff(principal);
  const status = input.status ?? WhatsAppUnmatchedStatus.PENDING;
  const [rows, pendingCount] = await Promise.all([
    db.whatsAppUnmatchedMessage.findMany({
      orderBy: { receivedAt: "desc" },
      take: Math.max(1, Math.min(input.limit ?? 50, 100)),
      where: { status },
    }),
    db.whatsAppUnmatchedMessage.count({
      where: { status: WhatsAppUnmatchedStatus.PENDING },
    }),
  ]);

  const candidateIds = [...new Set(rows.flatMap((row) => row.candidateLeadIds))];
  const leads = candidateIds.length
    ? await db.lead.findMany({
        select: { id: true, name: true },
        where: { id: { in: candidateIds } },
      })
    : [];
  const names = new Map(leads.map((lead) => [lead.id, lead.name]));

  return {
    items: rows.map((row) => ({
      body: row.body,
      businessLabel:
        context.channel?.numbers.find(
          (number) => number.phoneNumberId === row.businessPhoneNumberId,
        )?.label ?? null,
      businessPhoneNumberId: row.businessPhoneNumberId,
      candidates: row.candidateLeadIds
        .filter((id) => names.has(id))
        .map((id) => ({ id, name: names.get(id) ?? "" })),
      fromPhoneE164: row.fromPhoneE164,
      id: row.id,
      kind: row.kind,
      profileName: row.profileName,
      reason: row.reason,
      receivedAt: row.receivedAt,
      status: row.status,
    })),
    pendingCount,
  };
}

export async function attachUnmatchedWhatsAppMessage(
  principal: DomainPrincipal,
  input: { readonly unmatchedId: string; readonly leadId: number },
  db: TransactionalDomainDb,
  context: { readonly channel: WhatsAppChannel | null },
): Promise<{ leadId: number; conversationId: string; messageId: string }> {
  const staff = requireStaff(principal);
  await authorizeLead(staff, input.leadId, db);

  const row = await db.whatsAppUnmatchedMessage.findUnique({
    where: { id: input.unmatchedId },
  });
  if (!row) throw new DomainNotFoundError("Message not found");
  if (row.status !== WhatsAppUnmatchedStatus.PENDING) {
    throw new DomainTransitionError(
      "This message has already been reviewed.",
      row.status,
      WhatsAppUnmatchedStatus.ATTACHED,
    );
  }
  const business = context.channel?.numbers.find(
    (number) => number.phoneNumberId === row.businessPhoneNumberId,
  );

  try {
    return await db.$transaction(async (tx) => {
      // Claimed first and conditionally, so two people pressing Attach on two
      // different leads cannot both succeed.
      const claimed = await tx.whatsAppUnmatchedMessage.updateMany({
        data: {
          resolvedAt: new Date(),
          resolvedById: staff.userId,
          resolvedLeadId: input.leadId,
          status: WhatsAppUnmatchedStatus.ATTACHED,
        },
        where: { id: row.id, status: WhatsAppUnmatchedStatus.PENDING },
      });
      if (claimed.count !== 1) {
        throw new DomainTransitionError(
          "This message has already been reviewed.",
        );
      }
      return attachInbound(tx, {
        body: row.body,
        businessDisplayNumber: business?.displayNumber ?? row.businessPhoneNumberId,
        businessLabel: business?.label ?? "an unconfigured number",
        businessPhoneNumberId: row.businessPhoneNumberId,
        customerPhoneE164: row.fromPhoneE164,
        kind: row.kind,
        leadId: input.leadId,
        principal: staff,
        providerMessageId: row.providerMessageId,
        sentAt: row.receivedAt,
        via: "review",
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainTransitionError(
        "This message is already filed on a lead.",
      );
    }
    throw error;
  }
}

export async function dismissUnmatchedWhatsAppMessage(
  principal: DomainPrincipal,
  input: { readonly unmatchedId: string },
  db: DomainDb,
): Promise<void> {
  const staff = requireStaff(principal);
  const updated = await db.whatsAppUnmatchedMessage.updateMany({
    data: {
      resolvedAt: new Date(),
      resolvedById: staff.userId,
      status: WhatsAppUnmatchedStatus.DISMISSED,
    },
    where: { id: input.unmatchedId, status: WhatsAppUnmatchedStatus.PENDING },
  });
  if (updated.count !== 1) {
    const exists = await db.whatsAppUnmatchedMessage.findUnique({
      select: { id: true },
      where: { id: input.unmatchedId },
    });
    if (!exists) throw new DomainNotFoundError("Message not found");
    throw new DomainTransitionError("This message has already been reviewed.");
  }
}
