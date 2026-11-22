import { ProjectWhatsAppGroupStatus } from "@prisma/client";

import { assertCanSetUpProjectWhatsAppGroup } from "../../access/projects";
import type { DomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainTransitionError,
} from "../../errors";
import {
  isWhatsAppBridgeError,
  type WhatsAppBridgePort,
} from "../../ports/whatsapp-bridge";
import { isInternalPrincipal, type DomainPrincipal } from "../../principal";

// What the project-group commands (groups.ts, group-links.ts) and the bridge
// event handling (group-events.ts) share: who may manage a group, when the
// bridge is usable, and how a bridge failure reads to the office.

/** WhatsApp's own limit on a group subject. */
export const MAX_GROUP_SUBJECT_LENGTH = 100;

/**
 * A create or a link claim is one short exchange with the bridge, so a row
 * still CREATING after this is a request that died, not one in progress.
 */
export const GROUP_CREATE_DEADLINE_MS = 2 * 60 * 1000;

export const WHATSAPP_GROUP_REFUSALS = {
  disabled:
    "Project WhatsApp groups aren't set up here: the WhatsApp bridge isn't configured. See Admin › WhatsApp bridge.",
  notReceiving:
    "WhatsApp groups can't be used yet: WHATSAPP_BRIDGE_WEBHOOK_SECRET isn't set, so no group message would reach the app. See Admin › WhatsApp bridge.",
} as const;

/** The group is live: messages flow both ways. */
export const LIVE_STATUSES: ReadonlySet<ProjectWhatsAppGroupStatus> = new Set([
  ProjectWhatsAppGroupStatus.ACTIVE,
]);

/** A row in one of these holds no group and may take a new one. */
export const RELEASED_STATUSES = [
  ProjectWhatsAppGroupStatus.FAILED,
  ProjectWhatsAppGroupStatus.DELETED,
  ProjectWhatsAppGroupStatus.UNLINKED,
] as const;

export type ProjectWhatsAppGroupAvailability = {
  readonly available: boolean;
  /** Why not, as the office should read it. */
  readonly reason: string | null;
};

/** Whether this runtime can create, link or message project groups. */
export function projectWhatsAppGroupAvailability(
  bridge: WhatsAppBridgePort | null | undefined,
): ProjectWhatsAppGroupAvailability {
  if (!bridge) {
    return { available: false, reason: WHATSAPP_GROUP_REFUSALS.disabled };
  }
  if (!bridge.receivesEvents) {
    return { available: false, reason: WHATSAPP_GROUP_REFUSALS.notReceiving };
  }
  return { available: true, reason: null };
}

/** The bridge, for a command that must be able to receive the group's messages. */
export function requireBridge(
  bridge: WhatsAppBridgePort | null | undefined,
): WhatsAppBridgePort {
  const availability = projectWhatsAppGroupAvailability(bridge);
  if (!bridge || !availability.available) {
    throw new DomainTransitionError(
      availability.reason ?? WHATSAPP_GROUP_REFUSALS.disabled,
    );
  }
  return bridge;
}

/** Setting up a project's group is the office's (`canSetUpProjectWhatsAppGroup`). */
export function requireOffice(principal: DomainPrincipal): void {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Managing a project's WhatsApp group requires a member of staff.",
    );
  }
  assertCanSetUpProjectWhatsAppGroup(principal);
}

/** A bridge failure as the domain reports it: the bridge's own sentence. */
export function bridgeFailure(
  error: unknown,
  fallback: string,
): DomainSideEffectError {
  return new DomainSideEffectError(
    isWhatsAppBridgeError(error) ? error.message : fallback,
    "whatsapp",
    !isWhatsAppBridgeError(error) || error.code !== "not_found",
    { cause: error },
  );
}

/** Record a group's members as the bridge reported them. */
export async function writeParticipants(
  db: DomainDb,
  groupRowId: string,
  participants: readonly { jid: string; phoneE164: string | null }[],
  at: Date,
): Promise<void> {
  for (const participant of participants) {
    if (!participant.jid) continue;
    await db.projectWhatsAppParticipant.upsert({
      create: {
        groupId: groupRowId,
        joinedAt: at,
        phoneE164: participant.phoneE164,
        waId: participant.jid,
      },
      update: { leftAt: null, phoneE164: participant.phoneE164 },
      where: { groupId_waId: { groupId: groupRowId, waId: participant.jid } },
    });
  }
}
