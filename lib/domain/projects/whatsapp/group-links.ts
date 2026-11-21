import {
  ProjectWhatsAppGroupOrigin,
  ProjectWhatsAppGroupStatus,
} from "@prisma/client";

import { authorizeProject } from "../../access/projects";
import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainTransitionError, DomainValidationError } from "../../errors";
import {
  isWhatsAppBridgeError,
  type WhatsAppBridgeGroup,
  type WhatsAppBridgePort,
} from "../../ports/whatsapp-bridge";
import { attributionUserId, type DomainPrincipal } from "../../principal";
import { isUniqueViolation } from "../../leads/whatsapp/records";
import {
  bridgeFailure,
  GROUP_CREATE_DEADLINE_MS,
  LIVE_STATUSES,
  RELEASED_STATUSES,
  requireBridge,
  requireOffice,
  writeParticipants,
} from "./group-shared";
import { projectWhatsAppGroupSubject } from "./groups";
import {
  PROJECT_WHATSAPP_GROUP_SELECT,
  toProjectWhatsAppGroupRecord,
  type ProjectWhatsAppGroupRecord,
} from "./records";

// Linking a project to a group Royal's number is already in, unlinking it,
// refreshing its invite link, and keeping the bridge's mapped groups in step.
//
// The app is the source of truth; the bridge forwards only what it is told.
// The order of a link is what keeps the two honest:
//
//   1. claim the group id on the project's row (CREATING). The unique key on
//      the id means two links of one group cannot both win;
//   2. tell the bridge — so the app never believes a group is linked while
//      the bridge drops its messages;
//   3. make it ACTIVE with its members; if that fails, take the bridge's
//      mapping back.
//
// A resync replaces the bridge's list with the app's live and claimed links,
// then checks again, so a link made while it ran is not dropped.

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

const GROUP_JID = /^[0-9-]{5,40}@g\.us$/;

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

/**
 * Link one of the groups Royal's number is in to a project.
 *
 * For a project whose group was made on the phone, or before groups came to
 * the app, or after unlinking the wrong one. The group must be on the
 * bridge's list — an id typed from elsewhere is refused, because a group the
 * bridge cannot see would show an empty chat for ever. Messages from before
 * the link are not imported.
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
  if (!GROUP_JID.test(groupJid)) {
    throw new DomainValidationError("Choose a group to link.", "groupJid");
  }
  const now = ports.now ?? new Date();

  const existing = await db.projectWhatsAppGroup.findUnique({
    select: { ...PROJECT_WHATSAPP_GROUP_SELECT, createdAt: true },
    where: { projectId: project.id },
  });
  if (existing && LIVE_STATUSES.has(existing.status)) {
    if (existing.providerGroupId === groupJid) {
      // Linking what is already linked: make sure the bridge agrees.
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
      "A group is being set up for this project right now. Wait for it to finish before linking another.",
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

  // 1. Claim. Only a row that holds no group gives its id up; a group live
  // on another project keeps it, and the unique key refuses this claim.
  const subject = group.subject || projectWhatsAppGroupSubject(project);
  const claim = {
    failureReason: null,
    inviteLink: null,
    inviteLinkAt: null,
    linkedAt: now,
    needsReconciliation: false,
    origin: ProjectWhatsAppGroupOrigin.LINKED,
    providerGroupId: groupJid,
    status: ProjectWhatsAppGroupStatus.CREATING,
    subject,
  };
  let rowId: string;
  try {
    rowId = await db.$transaction(async (tx) => {
      await tx.projectWhatsAppGroup.updateMany({
        data: { providerGroupId: null },
        where: {
          projectId: { not: project.id },
          providerGroupId: groupJid,
          status: { in: [...RELEASED_STATUSES] },
        },
      });
      const row = await tx.projectWhatsAppGroup.upsert({
        create: {
          ...claim,
          createdById: attributionUserId(principal),
          projectId: project.id,
        },
        select: { id: true },
        // A reused row held another group; its members are not this one's.
        update: { ...claim, createdAt: now, participants: { deleteMany: {} } },
        where: { projectId: project.id },
      });
      return row.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainTransitionError(
        "That group is linked to another project. Unlink it there first.",
      );
    }
    throw error;
  }

  const release = async (reason: string) => {
    await db.projectWhatsAppGroup
      .updateMany({
        data: {
          failureReason: reason,
          providerGroupId: null,
          status: ProjectWhatsAppGroupStatus.FAILED,
        },
        where: { id: rowId, status: ProjectWhatsAppGroupStatus.CREATING },
      })
      .catch((error: unknown) =>
        console.error(
          `[whatsapp] Could not release a failed link claim (row ${rowId}).`,
          error,
        ),
      );
  };

  // 2. Tell the bridge.
  try {
    await bridge.setMapping(groupJid, project.id);
  } catch (error) {
    await release("The WhatsApp bridge couldn't be told about the link.");
    throw bridgeFailure(error, "The WhatsApp bridge couldn't be updated.");
  }

  // 3. Live, with its members.
  try {
    const row = await db.$transaction(async (tx) => {
      await tx.projectWhatsAppGroup.update({
        data: {
          failureReason: inviteLink
            ? null
            : "Royal's number isn't an admin of this group, so there's no invite link to send. Make it an admin in WhatsApp, then get the link.",
          inviteLink,
          inviteLinkAt: inviteLink ? now : null,
          status: ProjectWhatsAppGroupStatus.ACTIVE,
        },
        where: { id: rowId },
      });
      await writeParticipants(tx, rowId, group.participants, now);
      return tx.projectWhatsAppGroup.findUniqueOrThrow({
        select: PROJECT_WHATSAPP_GROUP_SELECT,
        where: { id: rowId },
      });
    });
    return { alreadyLinked: false, group: toProjectWhatsAppGroupRecord(row) };
  } catch (error) {
    await bridge
      .removeMapping(groupJid, project.id)
      .catch((removal: unknown) =>
        console.error(
          "[whatsapp] A failed link left its bridge mapping in place; the next resync removes it.",
          removal,
        ),
      );
    await release("The link couldn't be saved. Try again.");
    throw error;
  }
}

/**
 * Take a group off a project — the wrong group was linked, or the job is
 * done. The group itself is untouched in WhatsApp; the project keeps its
 * history; the bridge stops forwarding it.
 *
 * `groupJid` is the group the person confirmed; if the project's group
 * changed since, nothing is touched. `bridgeUpdated: false` means the bridge
 * could not be told now — the app already ignores the group's messages, and
 * the next resync tells the bridge.
 */
export async function unlinkProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly groupJid?: string | null },
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
      "The group is being set up right now. Wait for it to finish first.",
    );
  }
  const changed = () =>
    new DomainTransitionError(
      "This project's WhatsApp group changed since you opened this. Reload and check which group to unlink.",
    );
  if (input.groupJid && input.groupJid !== row.providerGroupId) throw changed();

  const updated = await db.projectWhatsAppGroup.updateMany({
    data: {
      failureReason: null,
      inviteLink: null,
      inviteLinkAt: null,
      providerGroupId: null,
      status: ProjectWhatsAppGroupStatus.UNLINKED,
    },
    where: {
      id: row.id,
      providerGroupId: row.providerGroupId,
      status: row.status,
    },
  });
  if (updated.count !== 1) throw changed();

  let bridgeUpdated = Boolean(ports.bridge) || !row.providerGroupId;
  if (row.providerGroupId && ports.bridge) {
    try {
      // Only this project's mapping: a newer link elsewhere stays.
      await ports.bridge.removeMapping(row.providerGroupId, project.id);
    } catch {
      bridgeUpdated = false;
    }
  }
  const group = await db.projectWhatsAppGroup.findUniqueOrThrow({
    select: PROJECT_WHATSAPP_GROUP_SELECT,
    where: { id: row.id },
  });
  return { bridgeUpdated, group: toProjectWhatsAppGroupRecord(group) };
}

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
  if (!row?.providerGroupId || !LIVE_STATUSES.has(row.status)) {
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

/** Live links, and links mid-claim (the bridge must keep forwarding those). */
async function mappingSnapshot(db: DomainDb) {
  const rows = await db.projectWhatsAppGroup.findMany({
    orderBy: { providerGroupId: "asc" },
    select: { projectId: true, providerGroupId: true },
    where: {
      providerGroupId: { not: null },
      status: {
        in: [
          ProjectWhatsAppGroupStatus.ACTIVE,
          ProjectWhatsAppGroupStatus.CREATING,
        ],
      },
    },
  });
  return rows.map((row) => ({
    groupJid: row.providerGroupId as string,
    projectId: row.projectId,
  }));
}

const sameMappings = (
  a: readonly { groupJid: string; projectId: string }[],
  b: readonly { groupJid: string; projectId: string }[],
) =>
  a.length === b.length
  && a.every(
    (mapping, index) =>
      mapping.groupJid === b[index]?.groupJid
      && mapping.projectId === b[index]?.projectId,
  );

/**
 * Replace the bridge's mapped groups with the app's. The app is the source
 * of truth; this repairs a link or unlink the bridge missed.
 *
 * A link can land between reading the app's list and the bridge replacing
 * its own; so the list is read again afterwards, and sent again if it moved.
 */
export async function reconcileWhatsAppBridgeMappings(
  principal: DomainPrincipal,
  db: DomainDb,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<{ added: number; removed: number; changed: number; total: number }> {
  if (principal.kind !== "system") requireOffice(principal);
  const bridge = requireBridge(ports.bridge);
  let mappings = await mappingSnapshot(db);
  let result = { added: 0, changed: 0, removed: 0 };
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const outcome = await bridge.replaceMappings(mappings);
      result = {
        added: result.added + outcome.added,
        changed: result.changed + outcome.changed,
        removed: result.removed + outcome.removed,
      };
    } catch (error) {
      throw bridgeFailure(error, "The WhatsApp bridge couldn't be updated.");
    }
    const after = await mappingSnapshot(db);
    if (sameMappings(after, mappings)) break;
    mappings = after;
  }
  return { ...result, total: mappings.length };
}
