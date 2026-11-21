import { ProjectWhatsAppGroupStatus } from "@prisma/client";

import { authorizeProjectRecording } from "../../access/projects";
import type { DomainDb } from "../../db";
import { DomainAuthorizationError, DomainValidationError } from "../../errors";
import type { WhatsAppBridgePort } from "../../ports/whatsapp-bridge";
import {
  isInternalPrincipal,
  isOfficePrincipal,
  type DomainPrincipal,
} from "../../principal";
import { leadPhoneE164 } from "../../leads/whatsapp/phone";
import { PROJECT_OWNER_SELECT, projectOwnerRows } from "../owners";
import {
  projectWhatsAppGroupAvailability,
  type ProjectWhatsAppGroupAvailability,
} from "./groups";
import {
  PROJECT_WHATSAPP_GROUP_SELECT,
  PROJECT_WHATSAPP_MESSAGE_SELECT,
  toProjectWhatsAppGroupRecord,
  toProjectWhatsAppMessageRecord,
  type ProjectWhatsAppGroupRecord,
  type ProjectWhatsAppMessageRecord,
} from "./records";

// Reading a project's WhatsApp group: whether groups are available here, the
// group, who of the owners has joined, and a page of the conversation.

const MAX_PAGE = 100;

export type ProjectWhatsAppOwner = {
  readonly name: string;
  readonly email: string | null;
  readonly phoneE164: string | null;
  /** Their number is in the group, as WhatsApp last reported. */
  readonly joined: boolean;
};

export type ProjectWhatsAppThread = {
  readonly projectId: string;
  /**
   * The lead the project came from, whose 1:1 chat sits beside the group.
   * Null for a caller outside the office: the 1:1 chat is the sales
   * conversation, and the lead is the sales record (#570).
   */
  readonly leadId: number | null;
  readonly leadName: string;
  readonly availability: ProjectWhatsAppGroupAvailability;
  readonly group: ProjectWhatsAppGroupRecord | null;
  readonly owners: readonly ProjectWhatsAppOwner[];
  /** Oldest first. */
  readonly messages: readonly ProjectWhatsAppMessageRecord[];
  readonly olderCursor: string | null;
};

function requireStaff(principal: DomainPrincipal) {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "A project's WhatsApp group is for staff only.",
    );
  }
}

export async function getProjectWhatsAppThread(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly before?: string | null;
    readonly limit?: number;
  },
  db: DomainDb,
  context: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<ProjectWhatsAppThread> {
  requireStaff(principal);
  await authorizeProjectRecording(principal, input.projectId, db);
  const limit = Math.max(1, Math.min(input.limit ?? 40, MAX_PAGE));

  const project = await db.project.findUniqueOrThrow({
    select: {
      ...PROJECT_OWNER_SELECT,
      id: true,
      Lead: { select: { id: true, name: true } },
      whatsappGroup: { select: PROJECT_WHATSAPP_GROUP_SELECT },
    },
    where: { id: input.projectId },
  });

  let cursor: { occurredAt: Date; id: string } | null = null;
  if (input.before) {
    cursor = await db.projectWhatsAppMessage.findFirst({
      select: { id: true, occurredAt: true },
      where: { id: input.before, projectId: project.id },
    });
    if (!cursor) {
      throw new DomainValidationError(
        "That page of the conversation is no longer available. Reload it.",
        "before",
      );
    }
  }

  const rows = project.whatsappGroup
    ? await db.projectWhatsAppMessage.findMany({
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: PROJECT_WHATSAPP_MESSAGE_SELECT,
        take: limit + 1,
        where: {
          projectId: project.id,
          ...(cursor
            ? {
                OR: [
                  { occurredAt: { lt: cursor.occurredAt } },
                  { id: { lt: cursor.id }, occurredAt: cursor.occurredAt },
                ],
              }
            : {}),
        },
      })
    : [];
  const page = rows.slice(0, limit);
  // Newest first from the query; the oldest on this page is the cursor.
  const olderCursor = rows.length > limit ? (page.at(-1)?.id ?? null) : null;

  const record = project.whatsappGroup
    ? toProjectWhatsAppGroupRecord(project.whatsappGroup)
    : null;
  // The invite link lets anyone holding it join the client's group; inviting
  // is the office's (`canSetUpProjectWhatsAppGroup`).
  const group =
    record && !isOfficePrincipal(principal)
      ? { ...record, inviteLink: null }
      : record;
  const inGroup = new Set(
    (group?.participants ?? [])
      .filter((participant) => !participant.leftAt && participant.phoneE164)
      .map((participant) => participant.phoneE164),
  );

  return {
    availability: projectWhatsAppGroupAvailability(context.bridge),
    group,
    leadId: isOfficePrincipal(principal) ? project.Lead.id : null,
    leadName: project.Lead.name,
    messages: [...page].reverse().map(toProjectWhatsAppMessageRecord),
    olderCursor,
    owners: projectOwnerRows(project).map((owner) => {
      const phoneE164 = leadPhoneE164(owner.phone);
      return {
        email: owner.email.trim() || null,
        joined: Boolean(phoneE164 && inGroup.has(phoneE164)),
        name: owner.name.trim(),
        phoneE164,
      };
    }),
    projectId: project.id,
  };
}

/** The office has seen the group's messages. */
export async function markProjectWhatsAppRead(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<void> {
  requireStaff(principal);
  await authorizeProjectRecording(principal, input.projectId, db);
  await db.projectWhatsAppGroup.updateMany({
    data: { unreadCount: 0 },
    where: {
      projectId: input.projectId,
      status: ProjectWhatsAppGroupStatus.ACTIVE,
    },
  });
}
