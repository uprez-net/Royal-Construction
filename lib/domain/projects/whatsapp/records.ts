import type {
  Prisma,
  ProjectWhatsAppGroupOrigin,
  ProjectWhatsAppGroupStatus,
  WhatsAppMessageDirection,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
} from "@prisma/client";

import {
  toWhatsAppMediaRecord,
  WHATSAPP_MEDIA_SELECT,
  type WhatsAppMediaRecord,
} from "../../whatsapp/media";

// The shapes the project WhatsApp commands and queries hand back. Typed domain
// records, not view models: the comms tab and the header shape them.

export const PROJECT_WHATSAPP_MESSAGE_SELECT = {
  author: { select: { name: true } },
  body: true,
  deliveredAt: true,
  direction: true,
  failedAt: true,
  groupId: true,
  id: true,
  kind: true,
  media: { select: WHATSAPP_MEDIA_SELECT },
  needsReconciliation: true,
  occurredAt: true,
  projectId: true,
  providerErrorCode: true,
  providerErrorTitle: true,
  readAt: true,
  senderName: true,
  senderPhoneE164: true,
  status: true,
  statusAt: true,
} satisfies Prisma.ProjectWhatsAppMessageSelect;

type RawMessage = Prisma.ProjectWhatsAppMessageGetPayload<{
  select: typeof PROJECT_WHATSAPP_MESSAGE_SELECT;
}>;

export type ProjectWhatsAppMessageRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly groupId: string;
  readonly direction: WhatsAppMessageDirection;
  readonly kind: WhatsAppMessageKind;
  readonly body: string;
  readonly status: WhatsAppMessageStatus;
  readonly statusAt: Date;
  readonly occurredAt: Date;
  readonly deliveredAt: Date | null;
  readonly readAt: Date | null;
  readonly failedAt: Date | null;
  readonly providerErrorCode: string | null;
  readonly providerErrorTitle: string | null;
  readonly needsReconciliation: boolean;
  /** Inbound: the participant's WhatsApp profile name, as they set it. */
  readonly senderName: string | null;
  readonly senderPhoneE164: string | null;
  /** Outbound: the staff member who sent it. */
  readonly authorName: string | null;
  readonly media: WhatsAppMediaRecord | null;
};

export function toProjectWhatsAppMessageRecord(
  row: RawMessage,
): ProjectWhatsAppMessageRecord {
  return {
    authorName: row.author?.name ?? null,
    body: row.body,
    deliveredAt: row.deliveredAt,
    direction: row.direction,
    failedAt: row.failedAt,
    groupId: row.groupId,
    id: row.id,
    kind: row.kind,
    media: toWhatsAppMediaRecord(row.media ?? null),
    needsReconciliation: row.needsReconciliation,
    occurredAt: row.occurredAt,
    projectId: row.projectId,
    providerErrorCode: row.providerErrorCode,
    providerErrorTitle: row.providerErrorTitle,
    readAt: row.readAt,
    senderName: row.senderName,
    senderPhoneE164: row.senderPhoneE164,
    status: row.status,
    statusAt: row.statusAt,
  };
}

export const PROJECT_WHATSAPP_GROUP_SELECT = {
  failureReason: true,
  id: true,
  inviteLink: true,
  lastMessageAt: true,
  linkedAt: true,
  needsReconciliation: true,
  origin: true,
  participants: {
    orderBy: { joinedAt: "asc" },
    select: { joinedAt: true, leftAt: true, phoneE164: true, waId: true },
  },
  projectId: true,
  providerGroupId: true,
  status: true,
  subject: true,
  unreadCount: true,
} satisfies Prisma.ProjectWhatsAppGroupSelect;

type RawGroup = Prisma.ProjectWhatsAppGroupGetPayload<{
  select: typeof PROJECT_WHATSAPP_GROUP_SELECT;
}>;

export type ProjectWhatsAppParticipantRecord = {
  /** Their WhatsApp id, as the bridge reported it. */
  readonly waId: string;
  readonly phoneE164: string | null;
  readonly joinedAt: Date | null;
  /** Set once they left or were removed. */
  readonly leftAt: Date | null;
};

export type ProjectWhatsAppGroupRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly status: ProjectWhatsAppGroupStatus;
  readonly origin: ProjectWhatsAppGroupOrigin;
  readonly subject: string;
  /**
   * Null until WhatsApp shares it (Royal's number must be a group admin).
   * Lets anyone holding it join the client's group: the office's to send.
   */
  readonly inviteLink: string | null;
  /** The group's WhatsApp id (…@g.us). */
  readonly providerGroupId: string | null;
  readonly failureReason: string | null;
  /** When it started belonging to the project; earlier messages are not imported. */
  readonly linkedAt: Date | null;
  /**
   * The last create was never confirmed, so the group may exist: the office
   * links it, or confirms there is none, before creating again.
   */
  readonly needsReconciliation: boolean;
  readonly lastMessageAt: Date | null;
  readonly unreadCount: number;
  readonly participants: readonly ProjectWhatsAppParticipantRecord[];
};

export function toProjectWhatsAppGroupRecord(
  row: RawGroup,
): ProjectWhatsAppGroupRecord {
  return {
    failureReason: row.failureReason,
    id: row.id,
    inviteLink: row.inviteLink,
    lastMessageAt: row.lastMessageAt,
    linkedAt: row.linkedAt,
    needsReconciliation: row.needsReconciliation,
    origin: row.origin,
    participants: row.participants.map((participant) => ({
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
      phoneE164: participant.phoneE164,
      waId: participant.waId,
    })),
    projectId: row.projectId,
    providerGroupId: row.providerGroupId,
    status: row.status,
    subject: row.subject,
    unreadCount: row.unreadCount,
  };
}
