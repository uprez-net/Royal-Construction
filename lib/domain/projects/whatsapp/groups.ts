import {
  OutboxEventKind,
  ProjectWhatsAppGroupOrigin,
  ProjectWhatsAppGroupStatus,
  WhatsAppUnmatchedReason,
  WhatsAppUnmatchedStatus,
} from "@prisma/client";

import { authorizeProject } from "../../access/projects";
import type { DomainDb, TransactionalDomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../../errors";
import { runOutboxEffectWithOutcome } from "../../outbox";
import {
  isWhatsAppSendError,
  type WhatsAppBusinessNumber,
  type WhatsAppChannel,
  type WhatsAppGroupsPort,
  type WhatsAppGroupSummary,
} from "../../ports/whatsapp";
import {
  attributionUserId,
  isInternalPrincipal,
  type DomainPrincipal,
} from "../../principal";
import { waIdToE164 } from "../../leads/whatsapp/phone";
import {
  PROJECT_WHATSAPP_GROUP_SELECT,
  toProjectWhatsAppGroupRecord,
  type ProjectWhatsAppGroupRecord,
} from "./records";

// A project's WhatsApp group: asking for one, learning it exists, linking one
// that already does, and following what WhatsApp says happens to it.
//
// The constraints come from Meta's Groups API and shape every rule here:
//
//   - Only an Official Business Account may use it. Until Royal's account has
//     that status, WHATSAPP_GROUPS_ENABLED is off and every command refuses
//     with a sentence the office can act on — never a half-made group.
//   - Creating is asynchronous. The create call answers with a request id;
//     the group id and invite link arrive on a `group_lifecycle_update`
//     webhook naming it. If that webhook never comes (not subscribed, lost),
//     `resolveCreatingProjectWhatsAppGroup` finds the group by its subject.
//   - The API sees only groups it created. "Link an existing group" therefore
//     offers the business number's own API-made groups, never a group someone
//     made on a phone — there is no way to read one.
//   - A create Meta may have accepted is never repeated blindly: a second
//     group with the owners split across two is worse than a wait.

/** WhatsApp's own limit on a group subject. */
export const MAX_GROUP_SUBJECT_LENGTH = 100;

/** How long a create may stay unconfirmed before it is reported as failed. */
export const GROUP_CREATE_DEADLINE_MS = 30 * 60 * 1000;

const STALE_CREATE_REASON =
  "WhatsApp never confirmed the group. Check WhatsApp Manager: if it exists, link it to this project; otherwise create it again.";

/** A create younger than this is "still being created", not stuck. */
const GROUP_CREATE_FRESH_MS = 2 * 60 * 1000;

export const WHATSAPP_GROUP_REFUSALS = {
  disabled:
    "WhatsApp groups aren't turned on. Meta only offers groups to Official Business Accounts — see Admin › WhatsApp.",
  noSending:
    "WhatsApp sending isn't configured in this runtime, so a group can't be created from here.",
  noNumber: "No WhatsApp business number is configured to own the group.",
} as const;

export type ProjectWhatsAppGroupAvailability = {
  readonly available: boolean;
  /** Why not, as the office should read it. */
  readonly reason: string | null;
};

/** Whether this deployment can create, link or message project groups. */
export function projectWhatsAppGroupAvailability(
  channel: WhatsAppChannel | null,
): ProjectWhatsAppGroupAvailability {
  if (!channel?.groupsEnabled) {
    return { available: false, reason: WHATSAPP_GROUP_REFUSALS.disabled };
  }
  if (!channel.sendingAvailable) {
    return { available: false, reason: WHATSAPP_GROUP_REFUSALS.noSending };
  }
  if (!ownerNumber(channel)) {
    return { available: false, reason: WHATSAPP_GROUP_REFUSALS.noNumber };
  }
  return { available: true, reason: null };
}

function ownerNumber(channel: WhatsAppChannel): WhatsAppBusinessNumber | null {
  return (
    channel.numbers.find(
      (number) => number.phoneNumberId === channel.defaultPhoneNumberId,
    )
    ?? channel.numbers[0]
    ?? null
  );
}

function requireGroups(
  channel: WhatsAppChannel | null,
  groups: WhatsAppGroupsPort | null | undefined,
): {
  channel: WhatsAppChannel;
  groups: WhatsAppGroupsPort;
  number: WhatsAppBusinessNumber;
} {
  const availability = projectWhatsAppGroupAvailability(channel);
  if (!availability.available || !channel) {
    throw new DomainTransitionError(
      availability.reason ?? WHATSAPP_GROUP_REFUSALS.disabled,
    );
  }
  if (!groups) {
    throw new DomainTransitionError(WHATSAPP_GROUP_REFUSALS.noSending);
  }
  const number = ownerNumber(channel);
  if (!number)
    throw new DomainTransitionError(WHATSAPP_GROUP_REFUSALS.noNumber);
  return { channel, groups, number };
}

/**
 * The group's name as everyone in it sees it: the business, then the job.
 * Also how a create whose webhook never arrived is found again, so it is
 * deterministic for a project.
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

export type RequestProjectWhatsAppGroupResult = {
  readonly group: ProjectWhatsAppGroupRecord;
  /**
   * True when the caller must start the create workflow for `group.id`.
   * False when a create is already under way, so nothing new was asked.
   */
  readonly start: boolean;
};

/**
 * Ask for a project's WhatsApp group.
 *
 * Writes the intent only — the CREATING row — and tells the caller whether to
 * start the workflow that calls Meta (lib/workflow/whatsapp-group.ts). Called
 * by a person for an ongoing project, and by the system right after a project
 * is created.
 */
export async function requestProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly now?: Date },
  db: DomainDb,
  context: { readonly channel: WhatsAppChannel | null },
): Promise<RequestProjectWhatsAppGroupResult> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Creating a WhatsApp group requires a member of staff.",
    );
  }
  const now = input.now ?? new Date();
  const project = await authorizeProject(principal, input.projectId, db);
  const availability = projectWhatsAppGroupAvailability(context.channel);
  if (!availability.available || !context.channel) {
    throw new DomainTransitionError(
      availability.reason ?? WHATSAPP_GROUP_REFUSALS.disabled,
    );
  }
  const number = ownerNumber(context.channel);
  if (!number)
    throw new DomainTransitionError(WHATSAPP_GROUP_REFUSALS.noNumber);

  const existing = await db.projectWhatsAppGroup.findUnique({
    select: {
      ...PROJECT_WHATSAPP_GROUP_SELECT,
      createAttempt: true,
      updatedAt: true,
    },
    where: { projectId: project.id },
  });
  if (existing) {
    if (
      existing.status === ProjectWhatsAppGroupStatus.ACTIVE
      || existing.status === ProjectWhatsAppGroupStatus.SUSPENDED
    ) {
      throw new DomainTransitionError(
        "This project already has a WhatsApp group.",
        existing.status,
        ProjectWhatsAppGroupStatus.CREATING,
      );
    }
    if (existing.status === ProjectWhatsAppGroupStatus.CREATING) {
      const since = (existing.requestedAt ?? existing.updatedAt).getTime();
      if (now.getTime() - since < GROUP_CREATE_DEADLINE_MS) {
        // A double-click, or the post-create hook and a person at once: one
        // group, and the second caller is told it is on its way.
        return {
          group: toProjectWhatsAppGroupRecord(existing),
          start: existing.requestedAt === null,
        };
      }
      // Stuck past the deadline. Mark it failed rather than ask again: Meta
      // may have made it, and a second group splits the owners across two.
      await db.projectWhatsAppGroup.updateMany({
        data: {
          failureReason: STALE_CREATE_REASON,
          status: ProjectWhatsAppGroupStatus.FAILED,
        },
        where: { id: existing.id, status: ProjectWhatsAppGroupStatus.CREATING },
      });
      throw new DomainTransitionError(
        `WhatsApp never confirmed the last group request, so it is now marked failed. Look in WhatsApp Manager for “${existing.subject}” and link it if it is there; otherwise create the group again.`,
      );
    }
  }

  const fields = {
    businessDisplayNumber: number.displayNumber,
    businessPhoneNumberId: number.phoneNumberId,
    createRequestId: null,
    failureReason: null,
    inviteLink: null,
    inviteLinkAt: null,
    origin: ProjectWhatsAppGroupOrigin.CREATED,
    providerGroupId: null,
    requestedAt: null,
    status: ProjectWhatsAppGroupStatus.CREATING,
    subject: projectWhatsAppGroupSubject(project),
  };
  const row = await db.projectWhatsAppGroup.upsert({
    create: {
      ...fields,
      createAttempt: 1,
      createdById: attributionUserId(principal),
      projectId: project.id,
    },
    select: PROJECT_WHATSAPP_GROUP_SELECT,
    // Only a FAILED or DELETED group reaches here: the old one is gone or was
    // never made, so this is a fresh attempt under a fresh outbox key.
    update: { ...fields, createAttempt: { increment: 1 } },
    where: { projectId: project.id },
  });
  return { group: toProjectWhatsAppGroupRecord(row), start: true };
}

export type SubmitGroupCreateOutcome =
  | "submitted"
  | "created"
  | "already_submitted"
  | "not_creating"
  | "refused"
  | "unconfirmed";

/**
 * Send the create request to Meta, once per attempt.
 *
 * The workflow step. A definite refusal marks the group FAILED with Meta's
 * reason; an ambiguous one leaves it CREATING with `requestedAt` set, so the
 * resolver can find the group if Meta made it after all.
 */
export async function submitProjectWhatsAppGroupCreate(
  principal: DomainPrincipal,
  input: { readonly groupRowId: string; readonly now?: Date },
  db: DomainDb,
  ports: { readonly groups: WhatsAppGroupsPort | null | undefined },
): Promise<{ outcome: SubmitGroupCreateOutcome }> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the WhatsApp group workflow may ask Meta for a group.",
    );
  }
  const now = input.now ?? new Date();
  const row = await db.projectWhatsAppGroup.findUnique({
    select: {
      businessPhoneNumberId: true,
      createAttempt: true,
      id: true,
      project: { select: { name: true } },
      projectId: true,
      requestedAt: true,
      status: true,
      subject: true,
    },
    where: { id: input.groupRowId },
  });
  if (!row)
    throw new DomainNotFoundError("That WhatsApp group is not on record.");
  if (row.status !== ProjectWhatsAppGroupStatus.CREATING) {
    return { outcome: "not_creating" };
  }
  if (row.requestedAt) return { outcome: "already_submitted" };
  if (!ports.groups) {
    throw new DomainSideEffectError(
      WHATSAPP_GROUP_REFUSALS.noSending,
      "whatsapp",
      false,
    );
  }
  const groups = ports.groups;

  type Receipt = {
    requestId: string | null;
    groupId: string | null;
    inviteLink: string | null;
  };
  let receipt: Receipt;
  let replayed: boolean;
  try {
    ({ replayed, result: receipt } = await runOutboxEffectWithOutcome<Receipt>(
      db,
      {
        key: `project-whatsapp-group:${row.id}:${row.createAttempt}`,
        kind: OutboxEventKind.PROJECT_WHATSAPP_GROUP_CREATE,
        payload: {
          businessPhoneNumberId: row.businessPhoneNumberId,
          projectId: row.projectId,
          subject: row.subject,
        },
      },
      async () => {
        const created = await groups.create({
          description: projectWhatsAppGroupDescription(row.project),
          fromPhoneNumberId: row.businessPhoneNumberId,
          subject: row.subject,
        });
        return {
          groupId: created.groupId,
          inviteLink: created.inviteLink,
          requestId: created.requestId,
        };
      },
    ));
  } catch (error) {
    if (error instanceof DomainTransitionError) {
      // Another run holds, or already finished, this attempt's intent — two
      // starts of the same workflow. That run owns the outcome.
      return { outcome: "already_submitted" };
    }
    const sendError = isWhatsAppSendError(error) ? error : null;
    if (sendError?.outcome === "not_sent") {
      await db.projectWhatsAppGroup.updateMany({
        data: {
          failureReason: `WhatsApp refused to create the group: ${sendError.message}`,
          status: ProjectWhatsAppGroupStatus.FAILED,
        },
        where: { id: row.id, status: ProjectWhatsAppGroupStatus.CREATING },
      });
      return { outcome: "refused" };
    }
    // Ambiguous — or the intent was already closed by an earlier crashed
    // attempt. Either way Meta may have made the group: look for it rather
    // than ask again.
    await db.projectWhatsAppGroup.updateMany({
      data: {
        failureReason:
          "WhatsApp didn't confirm the request. Looking for the group before asking again.",
        requestedAt: now,
      },
      where: { id: row.id, status: ProjectWhatsAppGroupStatus.CREATING },
    });
    return { outcome: "unconfirmed" };
  }

  await db.projectWhatsAppGroup.updateMany({
    data: {
      createRequestId: receipt.requestId,
      requestedAt: now,
      ...(receipt.groupId ? { providerGroupId: receipt.groupId } : {}),
      ...(receipt.groupId && receipt.inviteLink
        ? {
            failureReason: null,
            inviteLink: receipt.inviteLink,
            inviteLinkAt: now,
            status: ProjectWhatsAppGroupStatus.ACTIVE,
          }
        : {}),
    },
    where: { id: row.id, status: ProjectWhatsAppGroupStatus.CREATING },
  });
  if (replayed) return { outcome: "already_submitted" };
  return {
    outcome: receipt.groupId && receipt.inviteLink ? "created" : "submitted",
  };
}

export type ResolveGroupOutcome =
  | "active"
  | "waiting"
  | "failed"
  | "not_creating";

/**
 * Finish a create the lifecycle webhook has not confirmed.
 *
 * The workflow calls this on a timer after submitting, and the daily sweep
 * calls it for anything left over. If the group id is known it fetches the
 * invite link; otherwise it looks for a group with this project's subject
 * made since the request. Past the deadline it gives up and says so.
 */
export async function resolveCreatingProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly groupRowId: string; readonly now?: Date },
  db: DomainDb,
  ports: { readonly groups: WhatsAppGroupsPort | null | undefined },
): Promise<{ outcome: ResolveGroupOutcome }> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the WhatsApp group workflow may resolve a group.",
    );
  }
  const now = input.now ?? new Date();
  const row = await db.projectWhatsAppGroup.findUnique({
    select: {
      businessPhoneNumberId: true,
      id: true,
      providerGroupId: true,
      requestedAt: true,
      status: true,
      subject: true,
      updatedAt: true,
    },
    where: { id: input.groupRowId },
  });
  if (!row)
    throw new DomainNotFoundError("That WhatsApp group is not on record.");
  if (row.status === ProjectWhatsAppGroupStatus.ACTIVE)
    return { outcome: "active" };
  if (row.status !== ProjectWhatsAppGroupStatus.CREATING) {
    return { outcome: "not_creating" };
  }
  if (!row.requestedAt) {
    // Never reached Meta (the step died before the call, or never ran). Past
    // the deadline that is a failure to report, not something to wait on.
    if (now.getTime() - row.updatedAt.getTime() > GROUP_CREATE_DEADLINE_MS) {
      await db.projectWhatsAppGroup.updateMany({
        data: {
          failureReason: STALE_CREATE_REASON,
          status: ProjectWhatsAppGroupStatus.FAILED,
        },
        where: {
          id: row.id,
          requestedAt: null,
          status: ProjectWhatsAppGroupStatus.CREATING,
        },
      });
      return { outcome: "failed" };
    }
    return { outcome: "waiting" };
  }
  if (!ports.groups) return { outcome: "waiting" };

  let groupId = row.providerGroupId;
  if (!groupId) {
    let found: readonly WhatsAppGroupSummary[] = [];
    try {
      found = await ports.groups.list(row.businessPhoneNumberId);
    } catch {
      found = [];
    }
    const since = row.requestedAt.getTime() - GROUP_CREATE_FRESH_MS;
    const linked = new Set(
      (
        await db.projectWhatsAppGroup.findMany({
          select: { providerGroupId: true },
          where: { providerGroupId: { not: null } },
        })
      ).map((group) => group.providerGroupId),
    );
    const matches = found.filter(
      (group) =>
        group.subject === row.subject
        && !linked.has(group.groupId)
        && (group.createdAt === null || group.createdAt.getTime() >= since),
    );
    // Two matches means two creates landed; picking one is a guess. Leave it
    // for a person, who can link the right one.
    if (matches.length === 1) groupId = matches[0].groupId;
  }

  if (groupId) {
    try {
      const inviteLink = await ports.groups.inviteLink(groupId);
      await db.projectWhatsAppGroup.updateMany({
        data: {
          failureReason: null,
          inviteLink,
          inviteLinkAt: now,
          providerGroupId: groupId,
          status: ProjectWhatsAppGroupStatus.ACTIVE,
        },
        where: { id: row.id, status: ProjectWhatsAppGroupStatus.CREATING },
      });
      return { outcome: "active" };
    } catch {
      // Fall through to the deadline check; the next pass tries again.
    }
  }

  if (now.getTime() - row.requestedAt.getTime() > GROUP_CREATE_DEADLINE_MS) {
    await db.projectWhatsAppGroup.updateMany({
      data: {
        failureReason: STALE_CREATE_REASON,
        status: ProjectWhatsAppGroupStatus.FAILED,
      },
      where: { id: row.id, status: ProjectWhatsAppGroupStatus.CREATING },
    });
    return { outcome: "failed" };
  }
  return { outcome: "waiting" };
}

/** CREATING groups the sweep should look at again. */
export async function findUnresolvedProjectWhatsAppGroups(
  db: DomainDb,
  options: { readonly limit: number },
): Promise<{ id: string; submitted: boolean }[]> {
  const rows = await db.projectWhatsAppGroup.findMany({
    orderBy: { updatedAt: "asc" },
    select: { id: true, requestedAt: true },
    take: options.limit,
    where: { status: ProjectWhatsAppGroupStatus.CREATING },
  });
  return rows.map((row) => ({
    id: row.id,
    submitted: row.requestedAt !== null,
  }));
}

export type LinkableWhatsAppGroup = {
  readonly providerGroupId: string;
  readonly subject: string;
  readonly createdAt: Date | null;
  readonly businessPhoneNumberId: string;
  readonly businessLabel: string;
};

/**
 * Groups this business made through the API that no project has yet.
 *
 * Only API-made groups exist for the API, so a group the office created on a
 * phone will never appear here — the screen says so beside the list.
 */
export async function listLinkableWhatsAppGroups(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
  context: {
    readonly channel: WhatsAppChannel | null;
    readonly groups: WhatsAppGroupsPort | null | undefined;
  },
): Promise<LinkableWhatsAppGroup[]> {
  requireStaffUser(principal);
  await authorizeProject(principal, input.projectId, db);
  const { channel, groups } = requireGroups(context.channel, context.groups);

  const linked = new Set(
    (
      await db.projectWhatsAppGroup.findMany({
        select: { providerGroupId: true },
        where: {
          providerGroupId: { not: null },
          status: { not: ProjectWhatsAppGroupStatus.DELETED },
        },
      })
    ).map((group) => group.providerGroupId),
  );

  const result: LinkableWhatsAppGroup[] = [];
  for (const number of channel.numbers) {
    let found: readonly WhatsAppGroupSummary[];
    try {
      found = await groups.list(number.phoneNumberId);
    } catch (error) {
      throw new DomainSideEffectError(
        "WhatsApp's list of groups couldn't be read. Try again in a minute.",
        "whatsapp",
        true,
        { cause: error },
      );
    }
    for (const group of found) {
      if (linked.has(group.groupId)) continue;
      result.push({
        businessLabel: number.label,
        businessPhoneNumberId: number.phoneNumberId,
        createdAt: group.createdAt,
        providerGroupId: group.groupId,
        subject: group.subject,
      });
    }
  }
  return result;
}

/**
 * Link one of the business's API-made groups to a project.
 *
 * For a project that was underway before groups existed, or whose group was
 * made by hand in WhatsApp Manager. The group must be on the business's own
 * list — an id typed from elsewhere is refused, because a group we cannot read
 * would show an empty chat forever. Messages posted in the group before it
 * was linked, waiting as UNLINKED_GROUP, are filed onto the project.
 */
export async function linkProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly projectId: string; readonly providerGroupId: string },
  db: TransactionalDomainDb,
  context: {
    readonly channel: WhatsAppChannel | null;
    readonly groups: WhatsAppGroupsPort | null | undefined;
    readonly now?: Date;
  },
): Promise<{ group: ProjectWhatsAppGroupRecord; filedMessages: number }> {
  const staff = requireStaffUser(principal);
  const project = await authorizeProject(principal, input.projectId, db);
  const { channel, groups } = requireGroups(context.channel, context.groups);
  const providerGroupId = input.providerGroupId.trim();
  if (!providerGroupId) {
    throw new DomainValidationError(
      "Choose a group to link.",
      "providerGroupId",
    );
  }
  const now = context.now ?? new Date();

  const existing = await db.projectWhatsAppGroup.findUnique({
    select: { requestedAt: true, status: true, updatedAt: true },
    where: { projectId: project.id },
  });
  if (
    existing
    && (existing.status === ProjectWhatsAppGroupStatus.ACTIVE
      || existing.status === ProjectWhatsAppGroupStatus.SUSPENDED)
  ) {
    throw new DomainTransitionError(
      "This project already has a WhatsApp group.",
    );
  }
  if (
    existing?.status === ProjectWhatsAppGroupStatus.CREATING
    && now.getTime() - (existing.requestedAt ?? existing.updatedAt).getTime()
      < GROUP_CREATE_DEADLINE_MS
  ) {
    throw new DomainTransitionError(
      "A group is still being created for this project. Wait for it to finish, or for it to fail, before linking another.",
    );
  }
  const elsewhere = await db.projectWhatsAppGroup.findUnique({
    select: { projectId: true, status: true },
    where: { providerGroupId },
  });
  if (
    elsewhere
    && elsewhere.projectId !== project.id
    && elsewhere.status !== ProjectWhatsAppGroupStatus.DELETED
  ) {
    throw new DomainTransitionError(
      "That group is already linked to another project.",
    );
  }

  // Which number owns it, and is it ours at all.
  let owner: WhatsAppBusinessNumber | null = null;
  for (const number of channel.numbers) {
    let found: readonly WhatsAppGroupSummary[];
    try {
      found = await groups.list(number.phoneNumberId);
    } catch (error) {
      throw new DomainSideEffectError(
        "WhatsApp's list of groups couldn't be read. Try again in a minute.",
        "whatsapp",
        true,
        { cause: error },
      );
    }
    if (found.some((group) => group.groupId === providerGroupId)) {
      owner = number;
      break;
    }
  }
  if (!owner) {
    throw new DomainValidationError(
      "That group isn't one of this business's WhatsApp groups. Only groups created through the app or WhatsApp Manager's API can be linked.",
      "providerGroupId",
    );
  }

  let inviteLink: string;
  let info;
  try {
    [inviteLink, info] = await Promise.all([
      groups.inviteLink(providerGroupId),
      groups.info(providerGroupId),
    ]);
  } catch (error) {
    throw new DomainSideEffectError(
      "WhatsApp didn't return the group's details. Try again in a minute.",
      "whatsapp",
      true,
      { cause: error },
    );
  }

  return db.$transaction(async (tx) => {
    if (elsewhere && elsewhere.projectId !== project.id) {
      // A DELETED row on another project held this id; it can't be reused
      // in WhatsApp, but release it so the unique key does not refuse.
      await tx.projectWhatsAppGroup.updateMany({
        data: { providerGroupId: null },
        where: { providerGroupId },
      });
    }
    const fields = {
      businessDisplayNumber: owner.displayNumber,
      businessPhoneNumberId: owner.phoneNumberId,
      createRequestId: null,
      failureReason: null,
      inviteLink,
      inviteLinkAt: now,
      origin: ProjectWhatsAppGroupOrigin.LINKED,
      providerGroupId,
      requestedAt: null,
      status: info.suspended
        ? ProjectWhatsAppGroupStatus.SUSPENDED
        : ProjectWhatsAppGroupStatus.ACTIVE,
      subject: info.subject || projectWhatsAppGroupSubject(project),
    };
    const row = await tx.projectWhatsAppGroup.upsert({
      create: {
        ...fields,
        createdById: staff.userId,
        projectId: project.id,
      },
      select: { id: true },
      update: fields,
      where: { projectId: project.id },
    });

    for (const waId of info.participantWaIds) {
      await tx.projectWhatsAppParticipant.upsert({
        create: {
          groupId: row.id,
          joinedAt: now,
          phoneE164: waIdToE164(waId),
          waId,
        },
        update: { leftAt: null },
        where: { groupId_waId: { groupId: row.id, waId } },
      });
    }

    const filed = await fileUnlinkedGroupMessages(tx, {
      groupRowId: row.id,
      projectId: project.id,
      providerGroupId,
      resolvedById: staff.userId,
      now,
    });

    const group = await tx.projectWhatsAppGroup.findUniqueOrThrow({
      select: PROJECT_WHATSAPP_GROUP_SELECT,
      where: { id: row.id },
    });
    return {
      filedMessages: filed,
      group: toProjectWhatsAppGroupRecord(group),
    };
  });
}

/** Move messages that waited for this group onto the project's thread. */
async function fileUnlinkedGroupMessages(
  db: DomainDb,
  input: {
    readonly groupRowId: string;
    readonly projectId: string;
    readonly providerGroupId: string;
    readonly resolvedById: string | null;
    readonly now: Date;
  },
): Promise<number> {
  const waiting = await db.whatsAppUnmatchedMessage.findMany({
    orderBy: { receivedAt: "asc" },
    select: {
      body: true,
      fromPhoneE164: true,
      id: true,
      kind: true,
      media: { select: { id: true } },
      profileName: true,
      providerMessageId: true,
      receivedAt: true,
    },
    where: {
      providerGroupId: input.providerGroupId,
      reason: WhatsAppUnmatchedReason.UNLINKED_GROUP,
      status: WhatsAppUnmatchedStatus.PENDING,
    },
  });
  let latest: Date | null = null;
  for (const message of waiting) {
    const created = await db.projectWhatsAppMessage.create({
      data: {
        body: message.body,
        direction: "INBOUND",
        groupId: input.groupRowId,
        kind: message.kind,
        occurredAt: message.receivedAt,
        projectId: input.projectId,
        providerMessageId: message.providerMessageId,
        senderName: message.profileName,
        senderPhoneE164: message.fromPhoneE164,
        status: "RECEIVED",
        statusAt: message.receivedAt,
      },
      select: { id: true },
    });
    if (message.media) {
      await db.whatsAppMedia.update({
        data: { projectMessageId: created.id, unmatchedMessageId: null },
        where: { id: message.media.id },
      });
    }
    await db.whatsAppUnmatchedMessage.update({
      data: {
        resolvedAt: input.now,
        resolvedById: input.resolvedById,
        status: WhatsAppUnmatchedStatus.ATTACHED,
      },
      where: { id: message.id },
    });
    if (!latest || message.receivedAt > latest) latest = message.receivedAt;
  }
  if (waiting.length > 0) {
    await db.projectWhatsAppGroup.update({
      data: {
        lastMessageAt: latest,
        unreadCount: { increment: waiting.length },
      },
      where: { id: input.groupRowId },
    });
  }
  return waiting.length;
}

// ── What WhatsApp says happened to a group ──────────────────────────────

export type WhatsAppGroupEvent =
  | {
      readonly kind: "created";
      readonly requestId: string | null;
      readonly groupId: string;
      readonly subject: string | null;
      readonly inviteLink: string | null;
      readonly at: Date;
    }
  | {
      readonly kind: "create_failed";
      readonly requestId: string | null;
      readonly groupId: string | null;
      readonly reason: string;
      readonly at: Date;
    }
  | { readonly kind: "deleted"; readonly groupId: string; readonly at: Date }
  | {
      readonly kind: "participants_added" | "participants_removed";
      readonly groupId: string;
      readonly waIds: readonly string[];
      readonly at: Date;
    }
  | {
      readonly kind: "suspended" | "suspension_cleared";
      readonly groupId: string;
      readonly at: Date;
    }
  | {
      readonly kind: "subject_changed";
      readonly groupId: string;
      readonly subject: string;
      readonly at: Date;
    };

export type WhatsAppGroupEventOutcome = "applied" | "unknown_group";

/**
 * Apply one group webhook event.
 *
 * System principal only, like every inbound WhatsApp write. Idempotent: each
 * event sets a state rather than counting, so a redelivery changes nothing.
 */
export async function applyWhatsAppGroupEvent(
  principal: DomainPrincipal,
  event: WhatsAppGroupEvent,
  db: DomainDb,
): Promise<{ outcome: WhatsAppGroupEventOutcome }> {
  if (principal.kind !== "system") {
    throw new DomainAuthorizationError(
      "Only the verified WhatsApp webhook may record a group event.",
    );
  }

  if (event.kind === "created" || event.kind === "create_failed") {
    const row = await db.projectWhatsAppGroup.findFirst({
      select: { id: true, status: true },
      where: {
        OR: [
          ...(event.requestId ? [{ createRequestId: event.requestId }] : []),
          ...(event.groupId ? [{ providerGroupId: event.groupId }] : []),
        ],
      },
    });
    if (!row) return { outcome: "unknown_group" };
    if (event.kind === "created") {
      await db.projectWhatsAppGroup.update({
        data: {
          failureReason: null,
          providerGroupId: event.groupId,
          ...(event.inviteLink
            ? { inviteLink: event.inviteLink, inviteLinkAt: event.at }
            : {}),
          ...(event.subject ? { subject: event.subject } : {}),
          // Without a link the resolver fetches one and activates it.
          ...(event.inviteLink
          && row.status === ProjectWhatsAppGroupStatus.CREATING
            ? { status: ProjectWhatsAppGroupStatus.ACTIVE }
            : {}),
        },
        where: { id: row.id },
      });
    } else if (row.status === ProjectWhatsAppGroupStatus.CREATING) {
      await db.projectWhatsAppGroup.update({
        data: {
          failureReason: `WhatsApp couldn't create the group: ${event.reason}`,
          status: ProjectWhatsAppGroupStatus.FAILED,
        },
        where: { id: row.id },
      });
    }
    return { outcome: "applied" };
  }

  const row = await db.projectWhatsAppGroup.findUnique({
    select: { id: true, status: true },
    where: { providerGroupId: event.groupId },
  });
  if (!row) return { outcome: "unknown_group" };

  switch (event.kind) {
    case "deleted":
      await db.projectWhatsAppGroup.update({
        data: { inviteLink: null, status: ProjectWhatsAppGroupStatus.DELETED },
        where: { id: row.id },
      });
      break;
    case "suspended":
      if (row.status !== ProjectWhatsAppGroupStatus.DELETED) {
        await db.projectWhatsAppGroup.update({
          data: { status: ProjectWhatsAppGroupStatus.SUSPENDED },
          where: { id: row.id },
        });
      }
      break;
    case "suspension_cleared":
      if (row.status === ProjectWhatsAppGroupStatus.SUSPENDED) {
        await db.projectWhatsAppGroup.update({
          data: { status: ProjectWhatsAppGroupStatus.ACTIVE },
          where: { id: row.id },
        });
      }
      break;
    case "subject_changed":
      await db.projectWhatsAppGroup.update({
        data: { subject: event.subject },
        where: { id: row.id },
      });
      break;
    case "participants_added":
      for (const waId of event.waIds) {
        await db.projectWhatsAppParticipant.upsert({
          create: {
            groupId: row.id,
            joinedAt: event.at,
            phoneE164: waIdToE164(waId),
            waId,
          },
          update: { joinedAt: event.at, leftAt: null },
          where: { groupId_waId: { groupId: row.id, waId } },
        });
      }
      break;
    case "participants_removed":
      await db.projectWhatsAppParticipant.updateMany({
        data: { leftAt: event.at },
        where: { groupId: row.id, waId: { in: [...event.waIds] } },
      });
      break;
  }
  return { outcome: "applied" };
}

function requireStaffUser(principal: DomainPrincipal) {
  if (principal.kind !== "user" || !isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Managing a project's WhatsApp group requires a signed-in member of staff.",
    );
  }
  return principal;
}

/** How long an unsent request waits before someone opening it restarts it. */
const KICK_AFTER_MS = 2 * 60 * 1000;

/**
 * Claim the right to (re)start the create workflow for a request that was
 * recorded but never sent to Meta — Eve records requests it cannot start, and
 * a start can fail after the row is written. True for exactly one caller per
 * two minutes, so a screen polling the group cannot start a run per poll.
 */
export async function claimStalledProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: { readonly groupRowId: string; readonly now?: Date },
  db: DomainDb,
): Promise<boolean> {
  if (!isInternalPrincipal(principal)) return false;
  const now = input.now ?? new Date();
  const claimed = await db.projectWhatsAppGroup.updateMany({
    data: { failureReason: null },
    where: {
      id: input.groupRowId,
      requestedAt: null,
      status: ProjectWhatsAppGroupStatus.CREATING,
      updatedAt: { lt: new Date(now.getTime() - KICK_AFTER_MS) },
    },
  });
  return claimed.count === 1;
}
