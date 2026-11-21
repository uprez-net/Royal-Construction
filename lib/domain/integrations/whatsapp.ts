import {
  ProjectWhatsAppGroupStatus,
  WhatsAppMediaStatus,
  WhatsAppUnmatchedStatus,
} from "@prisma/client";

import type { DomainDb } from "../db";
import { requireAdminPrincipal, type DomainPrincipal } from "../principal";

// What the WhatsApp channel has been doing, for Admin › WhatsApp. Counts only
// — never a message body or a number — so the page is safe to leave open.

export type WhatsAppOperationalCounts = {
  readonly leadConversations: number;
  readonly projectGroups: Readonly<Record<ProjectWhatsAppGroupStatus, number>>;
  readonly media: Readonly<Record<WhatsAppMediaStatus, number>>;
  /** Waiting in the lead review queue. */
  readonly unmatchedPending: number;
  /** Sends WhatsApp never confirmed, waiting for a person. */
  readonly needsReconciliation: number;
};

export async function getWhatsAppOperationalCounts(
  principal: DomainPrincipal,
  db: DomainDb,
): Promise<WhatsAppOperationalCounts> {
  requireAdminPrincipal(principal);
  const [
    leadConversations,
    groups,
    media,
    unmatchedPending,
    leadReconcile,
    projectReconcile,
  ] = await Promise.all([
    db.leadWhatsAppConversation.count(),
    db.projectWhatsAppGroup.groupBy({ _count: { _all: true }, by: ["status"] }),
    db.whatsAppMedia.groupBy({ _count: { _all: true }, by: ["status"] }),
    db.whatsAppUnmatchedMessage.count({
      where: { status: WhatsAppUnmatchedStatus.PENDING },
    }),
    db.leadWhatsAppMessage.count({ where: { needsReconciliation: true } }),
    db.projectWhatsAppMessage.count({ where: { needsReconciliation: true } }),
  ]);

  const groupCounts = Object.fromEntries(
    Object.values(ProjectWhatsAppGroupStatus).map((status) => [status, 0]),
  ) as Record<ProjectWhatsAppGroupStatus, number>;
  for (const row of groups) groupCounts[row.status] = row._count._all;

  const mediaCounts = Object.fromEntries(
    Object.values(WhatsAppMediaStatus).map((status) => [status, 0]),
  ) as Record<WhatsAppMediaStatus, number>;
  for (const row of media) mediaCounts[row.status] = row._count._all;

  return {
    leadConversations,
    media: mediaCounts,
    needsReconciliation: leadReconcile + projectReconcile,
    projectGroups: groupCounts,
    unmatchedPending,
  };
}
