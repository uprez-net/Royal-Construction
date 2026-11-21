import { ProjectWhatsAppGroupStatus } from "@prisma/client";

import type { TransactionalDomainDb } from "../../db";
import { DomainAuthorizationError } from "../../errors";
import type { DomainPrincipal } from "../../principal";

// What the WhatsApp bridge reports about a linked group: a new subject, people
// joining and leaving — and Royal's own number being removed, which ends the
// link (the group can no longer be read or posted in).
//
// Each event is applied only while the project's row still holds that group:
// the lookup and the writes share a transaction, and the row is checked again
// before it commits, so an event for group A can never land on group B after
// staff relink the project.

export type WhatsAppGroupEvent =
  | {
      readonly kind: "subject_changed";
      readonly groupJid: string;
      readonly subject: string;
    }
  | {
      readonly kind: "participants_added" | "participants_removed";
      readonly groupJid: string;
      readonly participants: readonly {
        readonly jid: string;
        readonly phoneE164: string | null;
      }[];
      /** Royal's own number is among them. */
      readonly includesSelf?: boolean;
      readonly at: Date;
    };

export type WhatsAppGroupEventOutcome =
  | "applied"
  | "unknown_group"
  /** Royal's number was removed: the group is no longer live. */
  | "removed";

const REMOVED_REASON =
  "Royal's number was removed from this group, so its messages no longer reach the app. Its history stays here; create or link a group to carry on.";

class GroupChanged extends Error {}

/**
 * Apply one group event from the bridge.
 *
 * System principal only, like every inbound write. Idempotent: each event
 * sets a state rather than counting, so a redelivery changes nothing.
 */
export async function applyWhatsAppGroupEvent(
  principal: DomainPrincipal,
  event: WhatsAppGroupEvent,
  db: TransactionalDomainDb,
): Promise<{ outcome: WhatsAppGroupEventOutcome }> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp bridge webhook may record a group event.",
    );
  }
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.projectWhatsAppGroup.findUnique({
        select: { id: true, status: true },
        where: { providerGroupId: event.groupJid },
      });
      if (!row || row.status !== ProjectWhatsAppGroupStatus.ACTIVE) {
        return { outcome: "unknown_group" as const };
      }
      const stillThisGroup = { id: row.id, providerGroupId: event.groupJid };
      let outcome: WhatsAppGroupEventOutcome = "applied";

      switch (event.kind) {
        case "subject_changed":
          if (event.subject.trim()) {
            await tx.projectWhatsAppGroup.updateMany({
              data: { subject: event.subject.trim() },
              where: stillThisGroup,
            });
          }
          break;
        case "participants_added":
          for (const participant of event.participants) {
            await tx.projectWhatsAppParticipant.upsert({
              create: {
                groupId: row.id,
                joinedAt: event.at,
                phoneE164: participant.phoneE164,
                waId: participant.jid,
              },
              update: {
                joinedAt: event.at,
                leftAt: null,
                ...(participant.phoneE164
                  ? { phoneE164: participant.phoneE164 }
                  : {}),
              },
              where: {
                groupId_waId: { groupId: row.id, waId: participant.jid },
              },
            });
          }
          break;
        case "participants_removed":
          await tx.projectWhatsAppParticipant.updateMany({
            data: { leftAt: event.at },
            where: {
              groupId: row.id,
              waId: { in: event.participants.map((p) => p.jid) },
            },
          });
          if (event.includesSelf) {
            // Only this link ends; the people who merely left do not end it.
            await tx.projectWhatsAppGroup.updateMany({
              data: {
                failureReason: REMOVED_REASON,
                inviteLink: null,
                inviteLinkAt: null,
                status: ProjectWhatsAppGroupStatus.DELETED,
              },
              where: {
                ...stillThisGroup,
                status: ProjectWhatsAppGroupStatus.ACTIVE,
              },
            });
            outcome = "removed";
          }
          break;
      }

      // Relinked to another group while this ran: undo, report unknown.
      const now = await tx.projectWhatsAppGroup.findUnique({
        select: { providerGroupId: true },
        where: { id: row.id },
      });
      if (now?.providerGroupId !== event.groupJid) throw new GroupChanged();
      return { outcome };
    });
  } catch (error) {
    if (error instanceof GroupChanged) return { outcome: "unknown_group" };
    throw error;
  }
}
