import {
  OutboxEventKind,
  ProjectWhatsAppGroupOrigin,
  ProjectWhatsAppGroupStatus,
} from "@prisma/client";

import {
  assertCanSetUpProjectWhatsAppGroup,
  authorizeProject,
} from "../../access/projects";
import type { DomainDb, TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../../errors";
import { runOutboxEffectWithOutcome } from "../../outbox";
import { isWhatsAppSendError } from "../../ports/whatsapp";
import {
  isWhatsAppBridgeError,
  type WhatsAppBridgeGroup,
  type WhatsAppBridgePort,
} from "../../ports/whatsapp-bridge";
import {
  attributionUserId,
  isInternalPrincipal,
  type DomainPrincipal,
} from "../../principal";
import { leadPhoneE164 } from "../../leads/whatsapp/phone";
import { PROJECT_OWNER_SELECT, projectOwnerRows } from "../owners";
import {
  PROJECT_WHATSAPP_GROUP_SELECT,
  toProjectWhatsAppGroupRecord,
  type ProjectWhatsAppGroupRecord,
} from "./records";

// A project's WhatsApp group: creating one, linking one that already exists,
// unlinking it, and keeping the bridge's list of mapped groups in step.
//
// Groups live on Royal's own WhatsApp number, reached through the WhatsApp
// bridge (services/whatsapp-bridge; port: ports/whatsapp-bridge.ts). What that
// means for the rules here:
//
//   - Any group Royal's number is in can be linked — one made on the phone
//     included — and a create answers at once with the group id and link.
//   - The bridge forwards messages only for groups it has mapped to a
//     project. The app is the source of truth: every link and unlink is
//     pushed to the bridge, and `reconcileWhatsAppBridgeMappings` replaces
//     the bridge's list with the app's (the daily sweep, and Admin › WhatsApp
//     bridge). A link is pushed BEFORE it is committed, so the app never
//     believes a group is linked while the bridge drops its messages.
//   - A create the bridge may have carried out is never repeated blindly:
//     two groups with the owners split across them is worse than asking the
//     office to look at the bridge's group list and link the right one.

/** WhatsApp's own limit on a group subject. */
export const MAX_GROUP_SUBJECT_LENGTH = 100;

/**
 * A create is one request to the bridge, so a group still CREATING after this
 * is a request that died, not one in progress.
 */
export const GROUP_CREATE_DEADLINE_MS = 2 * 60 * 1000;

export const WHATSAPP_GROUP_REFUSALS = {
  disabled:
    "Project WhatsApp groups aren't set up here: the WhatsApp bridge isn't configured. See Admin › WhatsApp bridge.",
} as const;

const UNCONFIRMED_CREATE_REASON =
  "The WhatsApp bridge didn't confirm the group was created. Check Admin › WhatsApp bridge: if the group is listed, link it to this project; otherwise create it again.";

/** Statuses in which a project's group is live: messages flow and are sent. */
const LIVE = new Set<ProjectWhatsAppGroupStatus>([
  ProjectWhatsAppGroupStatus.ACTIVE,
]);

export type ProjectWhatsAppGroupAvailability = {
  readonly available: boolean;
  /** Why not, as the office should read it. */
  readonly reason: string | null;
};

/** Whether this runtime can create, link or message project groups. */
export function projectWhatsAppGroupAvailability(
  bridge: WhatsAppBridgePort | null | undefined,
): ProjectWhatsAppGroupAvailability {
  return bridge
    ? { available: true, reason: null }
    : { available: false, reason: WHATSAPP_GROUP_REFUSALS.disabled };
}

function requireBridge(
  bridge: WhatsAppBridgePort | null | undefined,
): WhatsAppBridgePort {
  if (!bridge)
    throw new DomainTransitionError(WHATSAPP_GROUP_REFUSALS.disabled);
  return bridge;
}

function requireOffice(principal: DomainPrincipal) {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Managing a project's WhatsApp group requires a member of staff.",
    );
  }
  assertCanSetUpProjectWhatsAppGroup(principal);
}

/** A bridge failure as the domain reports it: the bridge's own sentence. */
function bridgeFailure(
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

/**
 * The group's name as everyone in it sees it: the business, then the job.
 */
export function projectWhatsAppGroupSubject(project: {
  readonly name: string;
  readonly location: string;
}): string {
  const job = project.location.trim() || project.name.trim() || "Your build";
  const subject = `Royal Constructions · ${job}`.replace(/\s+/g, " ");
  return subject.length <= MAX_GROUP_SUBJECT_LENGTH
    ? subject
    : `${subject.slice(0, MAX_GROUP_SUBJECT_LENGTH - 1).trimEnd()}…`;
}

export function projectWhatsAppGroupDescription(project: {
  readonly name: string;
}): string {
  return `Updates and questions about ${project.name.trim() || "your build"} with the Royal Constructions team.`;
}

/** Record the group's members as the bridge reported them. */
async function writeParticipants(
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

// ── Create ──────────────────────────────────────────────────────────────

export type CreateProjectWhatsAppGroupResult = {
  readonly group: ProjectWhatsAppGroupRecord;
  /** Owners with a mobile on file, whom the bridge was asked to add. */
  readonly ownersAsked: number;
  /** Members WhatsApp reported once the group existed, Royal included. */
  readonly memberCount: number;
};

/**
 * Create a project's WhatsApp group on Royal's number and link it.
 *
 * The owners on the contract with a mobile on file are added straight away;
 * WhatsApp refuses anyone whose privacy settings forbid it, and they join
 * through the invite link the office then emails (invite.ts). The bridge maps
 * the new group to the project before it answers, so nothing posted in the
 * first seconds is lost.
 */
export async function createProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly now?: Date },
  db: DomainDb,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<CreateProjectWhatsAppGroupResult> {
  requireOffice(principal);
  const now = input.now ?? new Date();
  const project = await authorizeProject(principal, input.projectId, db);
  const bridge = requireBridge(ports.bridge);

  const existing = await db.projectWhatsAppGroup.findUnique({
    select: { createdAt: true, id: true, status: true, subject: true },
    where: { projectId: project.id },
  });
  if (existing && LIVE.has(existing.status)) {
    throw new DomainTransitionError(
      "This project already has a WhatsApp group.",
      existing.status,
      ProjectWhatsAppGroupStatus.CREATING,
    );
  }
  if (existing?.status === ProjectWhatsAppGroupStatus.CREATING) {
    if (
      now.getTime() - existing.createdAt.getTime()
      < GROUP_CREATE_DEADLINE_MS
    ) {
      // A double-click: one group, and the second press is told so.
      throw new DomainTransitionError(
        "The group is being created right now. Give it a moment.",
      );
    }
    // A request that died mid-way. The bridge may have made the group, so
    // say where to look instead of asking for a second one.
    await db.projectWhatsAppGroup.updateMany({
      data: {
        failureReason: UNCONFIRMED_CREATE_REASON,
        status: ProjectWhatsAppGroupStatus.FAILED,
      },
      where: { id: existing.id, status: ProjectWhatsAppGroupStatus.CREATING },
    });
    throw new DomainTransitionError(
      `The last request for this group never finished. Check Admin › WhatsApp bridge for “${existing.subject}” and link it if it's there; otherwise create the group again.`,
    );
  }

  const details = await db.project.findUniqueOrThrow({
    select: { ...PROJECT_OWNER_SELECT, location: true, name: true },
    where: { id: project.id },
  });
  const ownerPhones = [
    ...new Set(
      projectOwnerRows(details)
        .map((owner) => leadPhoneE164(owner.phone))
        .filter((phone): phone is string => Boolean(phone)),
    ),
  ];
  const subject = projectWhatsAppGroupSubject(details);

  // The intent, before the bridge is called: a fresh attempt number, so each
  // try is its own outbox key and a replay never makes a second group.
  const fields = {
    failureReason: null,
    inviteLink: null,
    inviteLinkAt: null,
    origin: ProjectWhatsAppGroupOrigin.CREATED,
    providerGroupId: null,
    status: ProjectWhatsAppGroupStatus.CREATING,
    subject,
  };
  const row = await db.projectWhatsAppGroup.upsert({
    create: {
      ...fields,
      createAttempt: 1,
      createdById: attributionUserId(principal),
      projectId: project.id,
    },
    select: { createAttempt: true, id: true },
    // Only a FAILED, DELETED or UNLINKED group reaches here. The row now
    // stands for the new attempt: its clock restarts, and the old group's
    // members are not members of the new one.
    update: {
      ...fields,
      createAttempt: { increment: 1 },
      createdAt: now,
      participants: { deleteMany: {} },
    },
    where: { projectId: project.id },
  });

  type Receipt = {
    groupJid: string;
    subject: string;
    inviteLink: string | null;
    participants: { jid: string; phoneE164: string | null }[];
  };
  let receipt: Receipt;
  try {
    ({ result: receipt } = await runOutboxEffectWithOutcome<Receipt>(
      db,
      {
        key: `project-whatsapp-group:${row.id}:${row.createAttempt}`,
        kind: OutboxEventKind.PROJECT_WHATSAPP_GROUP_CREATE,
        payload: { owners: ownerPhones.length, projectId: project.id, subject },
      },
      async () => {
        const created = await bridge.createGroup({
          description: projectWhatsAppGroupDescription(details),
          participantsE164: ownerPhones,
          projectId: project.id,
          subject,
        });
        return {
          groupJid: created.group.jid,
          inviteLink: created.inviteLink,
          participants: created.group.participants.map((participant) => ({
            jid: participant.jid,
            phoneE164: participant.phoneE164,
          })),
          subject: created.group.subject || subject,
        };
      },
    ));
  } catch (error) {
    const definite = isWhatsAppSendError(error) && error.outcome === "not_sent";
    const reason = definite
      ? `The group wasn't created: ${error.message}`
      : UNCONFIRMED_CREATE_REASON;
    await db.projectWhatsAppGroup.updateMany({
      data: {
        failureReason: reason,
        status: ProjectWhatsAppGroupStatus.FAILED,
      },
      where: { id: row.id, status: ProjectWhatsAppGroupStatus.CREATING },
    });
    if (error instanceof DomainTransitionError) throw error;
    throw new DomainSideEffectError(reason, "whatsapp", definite, {
      cause: error,
    });
  }

  await db.projectWhatsAppGroup.update({
    data: {
      failureReason: receipt.inviteLink
        ? null
        : "The group was created, but WhatsApp didn't share its invite link yet. Use “Refresh link” before inviting the owners.",
      inviteLink: receipt.inviteLink,
      inviteLinkAt: receipt.inviteLink ? now : null,
      providerGroupId: receipt.groupJid,
      status: ProjectWhatsAppGroupStatus.ACTIVE,
      subject: receipt.subject,
    },
    where: { id: row.id },
  });
  await writeParticipants(db, row.id, receipt.participants, now);
  const group = await db.projectWhatsAppGroup.findUniqueOrThrow({
    select: PROJECT_WHATSAPP_GROUP_SELECT,
    where: { id: row.id },
  });
  return {
    group: toProjectWhatsAppGroupRecord(group),
    memberCount: receipt.participants.length,
    ownersAsked: ownerPhones.length,
  };
}

// ── The bridge's groups, for linking ────────────────────────────────────

export type WhatsAppBridgeGroupListing = {
  readonly groupJid: string;
  readonly subject: string;
  readonly createdAt: Date | null;
  readonly memberCount: number;
  /** Royal's number is an admin, so it can share the link and add people. */
  readonly isAdmin: boolean;
  /** The project the app has linked this group to, if any. */
  readonly linkedProject: {
    readonly id: string;
    readonly name: string;
    readonly location: string;
  } | null;
  /**
   * The bridge forwards this group for a different project than the app
   * has linked (or for one when the app has none): fixed by "Resync".
   */
  readonly mappingDrift: boolean;
};

/**
 * Every group Royal's WhatsApp number is in, with the project each is linked
 * to. For Admin › WhatsApp bridge, and the project page's "Link a group".
 */
export async function listWhatsAppBridgeGroups(
  principal: DomainPrincipal,
  db: DomainDb,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<WhatsAppBridgeGroupListing[]> {
  requireOffice(principal);
  const bridge = requireBridge(ports.bridge);
  let groups: readonly WhatsAppBridgeGroup[];
  try {
    groups = await bridge.listGroups();
  } catch (error) {
    throw bridgeFailure(
      error,
      "The WhatsApp bridge's groups couldn't be read.",
    );
  }
  const linked = await db.projectWhatsAppGroup.findMany({
    select: {
      project: { select: { id: true, location: true, name: true } },
      providerGroupId: true,
    },
    where: {
      providerGroupId: { in: groups.map((group) => group.jid) },
      status: ProjectWhatsAppGroupStatus.ACTIVE,
    },
  });
  const byJid = new Map(
    linked.map((row) => [row.providerGroupId, row.project]),
  );
  return groups.map((group) => {
    const project = byJid.get(group.jid) ?? null;
    return {
      createdAt: group.createdAt,
      groupJid: group.jid,
      isAdmin: group.isAdmin,
      linkedProject: project,
      mappingDrift: (project?.id ?? null) !== group.mappedProjectId,
      memberCount: group.participants.length,
      subject: group.subject,
    };
  });
}

// ── Link ────────────────────────────────────────────────────────────────

/**
 * Link one of the groups Royal's number is in to a project.
 *
 * For a project whose group was made on the phone, or before groups came to
 * the app, or after unlinking the wrong one. The group must be on the
 * bridge's list — an id typed from elsewhere is refused, because a group the
 * bridge cannot see would show an empty chat for ever.
 */
export async function linkProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly groupJid: string },
  db: TransactionalDomainDb,
  ports: {
    readonly bridge: WhatsAppBridgePort | null | undefined;
    readonly now?: Date;
  },
): Promise<{ group: ProjectWhatsAppGroupRecord; alreadyLinked: boolean }> {
  requireOffice(principal);
  const project = await authorizeProject(principal, input.projectId, db);
  const bridge = requireBridge(ports.bridge);
  const groupJid = input.groupJid.trim();
  if (!/^[0-9-]{5,40}@g\.us$/.test(groupJid)) {
    throw new DomainValidationError("Choose a group to link.", "groupJid");
  }
  const now = ports.now ?? new Date();

  const existing = await db.projectWhatsAppGroup.findUnique({
    select: {
      ...PROJECT_WHATSAPP_GROUP_SELECT,
      createdAt: true,
    },
    where: { projectId: project.id },
  });
  if (existing && LIVE.has(existing.status)) {
    if (existing.providerGroupId === groupJid) {
      // Linking what is already linked: make sure the bridge agrees, and say so.
      try {
        await bridge.setMapping(groupJid, project.id);
      } catch (error) {
        throw bridgeFailure(error, "The WhatsApp bridge couldn't be updated.");
      }
      return {
        alreadyLinked: true,
        group: toProjectWhatsAppGroupRecord(existing),
      };
    }
    throw new DomainTransitionError(
      "This project already has a WhatsApp group. Unlink it first to link a different one.",
    );
  }
  if (
    existing?.status === ProjectWhatsAppGroupStatus.CREATING
    && now.getTime() - existing.createdAt.getTime() < GROUP_CREATE_DEADLINE_MS
  ) {
    throw new DomainTransitionError(
      "A group is being created for this project right now. Wait for it to finish before linking another.",
    );
  }
  const elsewhere = await db.projectWhatsAppGroup.findUnique({
    select: { projectId: true, status: true },
    where: { providerGroupId: groupJid },
  });
  if (
    elsewhere
    && elsewhere.projectId !== project.id
    && LIVE.has(elsewhere.status)
  ) {
    throw new DomainTransitionError(
      "That group is linked to another project. Unlink it there first.",
    );
  }

  let group: WhatsAppBridgeGroup;
  try {
    group = await bridge.group(groupJid);
  } catch (error) {
    if (isWhatsAppBridgeError(error) && error.code === "not_found") {
      throw new DomainValidationError(
        "That group isn't on Royal's WhatsApp. Only groups Royal's number is in can be linked.",
        "groupJid",
      );
    }
    throw bridgeFailure(error, "The WhatsApp bridge couldn't read that group.");
  }
  let inviteLink: string | null = null;
  try {
    inviteLink = await bridge.inviteLink(groupJid);
  } catch {
    // Royal's number isn't an admin there. The group links and messages
    // flow; only the invite email waits until someone makes it an admin.
    inviteLink = null;
  }

  // Tell the bridge first. If this fails nothing is written; if the commit
  // below fails, the mapping is taken back.
  try {
    await bridge.setMapping(groupJid, project.id);
  } catch (error) {
    throw bridgeFailure(error, "The WhatsApp bridge couldn't be updated.");
  }

  try {
    const row = await db.$transaction(async (tx) => {
      // A dead row elsewhere (unlinked, deleted, failed) may still hold the id.
      await tx.projectWhatsAppGroup.updateMany({
        data: { providerGroupId: null },
        where: { projectId: { not: project.id }, providerGroupId: groupJid },
      });
      const fields = {
        failureReason: inviteLink
          ? null
          : "Royal's number isn't an admin of this group, so there's no invite link to send. Make it an admin in WhatsApp, then refresh the link.",
        inviteLink,
        inviteLinkAt: inviteLink ? now : null,
        origin: ProjectWhatsAppGroupOrigin.LINKED,
        providerGroupId: groupJid,
        status: ProjectWhatsAppGroupStatus.ACTIVE,
        subject: group.subject || projectWhatsAppGroupSubject(project),
      };
      const saved = await tx.projectWhatsAppGroup.upsert({
        create: {
          ...fields,
          createdById: attributionUserId(principal),
          projectId: project.id,
        },
        select: { id: true },
        // A reused row held another group; its members are not this one's.
        update: { ...fields, participants: { deleteMany: {} } },
        where: { projectId: project.id },
      });
      await writeParticipants(tx, saved.id, group.participants, now);
      return tx.projectWhatsAppGroup.findUniqueOrThrow({
        select: PROJECT_WHATSAPP_GROUP_SELECT,
        where: { id: saved.id },
      });
    });
    return { alreadyLinked: false, group: toProjectWhatsAppGroupRecord(row) };
  } catch (error) {
    await bridge.removeMapping(groupJid).catch(() => undefined);
    throw error;
  }
}

// ── Unlink ──────────────────────────────────────────────────────────────

/**
 * Take a group off a project — the wrong group was linked, or the job is
 * done. The group itself is untouched in WhatsApp; the project keeps its
 * history; the bridge stops forwarding it.
 *
 * `bridgeUpdated: false` means the bridge could not be told right now. The app
 * already ignores the group's messages, and the next resync tells the bridge.
 */
export async function unlinkProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<{ group: ProjectWhatsAppGroupRecord; bridgeUpdated: boolean }> {
  requireOffice(principal);
  const project = await authorizeProject(principal, input.projectId, db);
  const row = await db.projectWhatsAppGroup.findUnique({
    select: { id: true, providerGroupId: true, status: true },
    where: { projectId: project.id },
  });
  if (!row || row.status === ProjectWhatsAppGroupStatus.UNLINKED) {
    throw new DomainTransitionError(
      "This project has no WhatsApp group linked.",
    );
  }
  if (row.status === ProjectWhatsAppGroupStatus.CREATING) {
    throw new DomainTransitionError(
      "The group is being created right now. Wait for it to finish first.",
    );
  }
  const updated = await db.projectWhatsAppGroup.update({
    data: {
      failureReason: null,
      inviteLink: null,
      inviteLinkAt: null,
      providerGroupId: null,
      status: ProjectWhatsAppGroupStatus.UNLINKED,
    },
    select: PROJECT_WHATSAPP_GROUP_SELECT,
    where: { id: row.id },
  });
  let bridgeUpdated = true;
  if (row.providerGroupId && ports.bridge) {
    try {
      await ports.bridge.removeMapping(row.providerGroupId);
    } catch {
      bridgeUpdated = false;
    }
  }
  return { bridgeUpdated, group: toProjectWhatsAppGroupRecord(updated) };
}

// ── Refresh the invite link ─────────────────────────────────────────────

/** Ask WhatsApp for the group's current invite link. */
export async function refreshProjectWhatsAppInviteLink(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly now?: Date },
  db: DomainDb,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<ProjectWhatsAppGroupRecord> {
  requireOffice(principal);
  const project = await authorizeProject(principal, input.projectId, db);
  const bridge = requireBridge(ports.bridge);
  const row = await db.projectWhatsAppGroup.findUnique({
    select: { id: true, providerGroupId: true, status: true },
    where: { projectId: project.id },
  });
  if (!row?.providerGroupId || !LIVE.has(row.status)) {
    throw new DomainTransitionError(
      "This project has no active WhatsApp group.",
    );
  }
  let inviteLink: string;
  try {
    inviteLink = await bridge.inviteLink(row.providerGroupId);
  } catch (error) {
    throw bridgeFailure(
      error,
      "WhatsApp didn't share the group's invite link.",
    );
  }
  const updated = await db.projectWhatsAppGroup.update({
    data: {
      failureReason: null,
      inviteLink,
      inviteLinkAt: input.now ?? new Date(),
    },
    select: PROJECT_WHATSAPP_GROUP_SELECT,
    where: { id: row.id },
  });
  return toProjectWhatsAppGroupRecord(updated);
}

// ── Keeping the bridge in step ──────────────────────────────────────────

/**
 * Replace the bridge's mapped groups with the app's live ones. The app is
 * the source of truth; this repairs a link or unlink the bridge missed.
 */
export async function reconcileWhatsAppBridgeMappings(
  principal: DomainPrincipal,
  db: DomainDb,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<{ added: number; removed: number; changed: number; total: number }> {
  if (principal.kind !== "system") requireOffice(principal);
  const bridge = requireBridge(ports.bridge);
  const rows = await db.projectWhatsAppGroup.findMany({
    select: { projectId: true, providerGroupId: true },
    where: {
      providerGroupId: { not: null },
      status: ProjectWhatsAppGroupStatus.ACTIVE,
    },
  });
  const mappings = rows.map((row) => ({
    groupJid: row.providerGroupId as string,
    projectId: row.projectId,
  }));
  try {
    const result = await bridge.replaceMappings(mappings);
    return { ...result, total: mappings.length };
  } catch (error) {
    throw bridgeFailure(error, "The WhatsApp bridge couldn't be updated.");
  }
}

// ── What the bridge says happened to a group ────────────────────────────

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
      readonly at: Date;
    };

export type WhatsAppGroupEventOutcome = "applied" | "unknown_group";

/**
 * Apply one group event from the bridge.
 *
 * System principal only, like every inbound write. Idempotent: each event
 * sets a state rather than counting, so a redelivery changes nothing.
 */
export async function applyWhatsAppGroupEvent(
  principal: DomainPrincipal,
  event: WhatsAppGroupEvent,
  db: DomainDb,
): Promise<{ outcome: WhatsAppGroupEventOutcome }> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp bridge webhook may record a group event.",
    );
  }
  const row = await db.projectWhatsAppGroup.findUnique({
    select: { id: true, status: true },
    where: { providerGroupId: event.groupJid },
  });
  if (!row || !LIVE.has(row.status)) return { outcome: "unknown_group" };

  switch (event.kind) {
    case "subject_changed":
      if (event.subject.trim()) {
        await db.projectWhatsAppGroup.update({
          data: { subject: event.subject.trim() },
          where: { id: row.id },
        });
      }
      break;
    case "participants_added":
      for (const participant of event.participants) {
        await db.projectWhatsAppParticipant.upsert({
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
          where: { groupId_waId: { groupId: row.id, waId: participant.jid } },
        });
      }
      break;
    case "participants_removed":
      await db.projectWhatsAppParticipant.updateMany({
        data: { leftAt: event.at },
        where: {
          groupId: row.id,
          waId: {
            in: event.participants.map((participant) => participant.jid),
          },
        },
      });
      break;
  }
  return { outcome: "applied" };
}
