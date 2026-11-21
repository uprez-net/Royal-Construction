import {
  OutboxEventKind,
  OutboxEventStatus,
  ProjectWhatsAppGroupOrigin,
  ProjectWhatsAppGroupStatus,
  type Prisma,
} from "@prisma/client";

import { authorizeProject } from "../../access/projects";
import type { DomainDb, TransactionalDomainDb } from "../../db";
import { DomainSideEffectError, DomainTransitionError } from "../../errors";
import { runOutboxEffectWithOutcome } from "../../outbox";
import { isWhatsAppSendError } from "../../ports/whatsapp";
import type { WhatsAppBridgePort } from "../../ports/whatsapp-bridge";
import { attributionUserId, type DomainPrincipal } from "../../principal";
import { leadPhoneE164 } from "../../leads/whatsapp/phone";
import { isUniqueViolation } from "../../leads/whatsapp/records";
import { PROJECT_OWNER_SELECT, projectOwnerRows } from "../owners";
import {
  GROUP_CREATE_DEADLINE_MS,
  LIVE_STATUSES,
  MAX_GROUP_SUBJECT_LENGTH,
  RELEASED_STATUSES,
  requireBridge,
  requireOffice,
  writeParticipants,
} from "./group-shared";
import {
  PROJECT_WHATSAPP_GROUP_SELECT,
  toProjectWhatsAppGroupRecord,
  type ProjectWhatsAppGroupRecord,
} from "./records";

// Creating a project's WhatsApp group on Royal's own number, through the
// WhatsApp bridge (services/whatsapp-bridge; port: ports/whatsapp-bridge.ts).
// Linking an existing group, unlinking and resyncing are group-links.ts; what
// the bridge reports about a group is group-events.ts.
//
// A create the bridge may have carried out is never repeated blindly: two
// groups with the owners split across them is worse than asking the office to
// look at the bridge's group list and link the right one. So:
//
//   - the claim is one conditional write, so a double click cannot start two;
//   - each attempt is its own outbox intent;
//   - an unconfirmed attempt leaves `needsReconciliation` set, and another
//     create is refused until the office links what it finds or confirms
//     there is nothing (`confirmNoGroup`);
//   - the bridge's answer is kept with the intent, so if saving the group
//     fails afterwards, the next press finishes it from that answer.

const UNCONFIRMED_CREATE_REASON =
  "The WhatsApp bridge didn't confirm the group was created. Check Admin › WhatsApp bridge: if the group is listed, link it to this project; if it isn't, create it again.";

const BEING_CREATED = "The group is being created right now. Give it a moment.";

/** The group's name as everyone in it sees it: the business, then the job. */
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

export type CreateProjectWhatsAppGroupResult = {
  readonly group: ProjectWhatsAppGroupRecord;
  /** Owners with a mobile on file, whom the bridge was asked to add. */
  readonly ownersAsked: number;
  /** Members WhatsApp reported once the group existed, Royal included. */
  readonly memberCount: number;
};

/** What the bridge answered, as kept with the outbox intent. */
type CreateReceipt = {
  groupJid: string;
  subject: string;
  inviteLink: string | null;
  participants: { jid: string; phoneE164: string | null }[];
  ownersAsked: number;
};

function createKey(rowId: string, attempt: number): string {
  return `project-whatsapp-group:${rowId}:${attempt}`;
}

/** Make the row the live group, with its members, in one transaction. */
async function activate(
  db: TransactionalDomainDb,
  rowId: string,
  receipt: CreateReceipt,
  now: Date,
): Promise<ProjectWhatsAppGroupRecord> {
  const row = await db.$transaction(async (tx) => {
    await tx.projectWhatsAppGroup.update({
      data: {
        failureReason: receipt.inviteLink
          ? null
          : "The group was created, but WhatsApp didn't share its invite link yet. Use “Get invite link” before inviting the owners.",
        inviteLink: receipt.inviteLink,
        inviteLinkAt: receipt.inviteLink ? now : null,
        needsReconciliation: false,
        providerGroupId: receipt.groupJid,
        status: ProjectWhatsAppGroupStatus.ACTIVE,
        subject: receipt.subject,
      },
      where: { id: rowId },
    });
    await writeParticipants(tx, rowId, receipt.participants, now);
    return tx.projectWhatsAppGroup.findUniqueOrThrow({
      select: PROJECT_WHATSAPP_GROUP_SELECT,
      where: { id: rowId },
    });
  });
  return toProjectWhatsAppGroupRecord(row);
}

/** The bridge's answer to an attempt that went through, if it did. */
async function succeededReceipt(
  db: DomainDb,
  rowId: string,
  attempt: number,
): Promise<CreateReceipt | null> {
  const intent = await db.outboxEvent.findUnique({
    select: { result: true, status: true },
    where: { key: createKey(rowId, attempt) },
  });
  if (intent?.status !== OutboxEventStatus.SUCCEEDED || !intent.result) {
    return null;
  }
  const result = intent.result as Prisma.JsonObject;
  return typeof result.groupJid === "string" && result.groupJid
    ? (result as unknown as CreateReceipt)
    : null;
}

/**
 * Create a project's WhatsApp group on Royal's number and link it.
 *
 * The owners on the contract with a mobile on file are added straight away;
 * WhatsApp refuses anyone whose privacy settings forbid it, and they join
 * through the invite link the office then emails (invite.ts). The bridge maps
 * the new group to the project before it answers, and the app holds the
 * group's first messages until the group is saved (inbound.ts), so nothing
 * posted in the first seconds is lost.
 */
export async function createProjectWhatsAppGroup(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    /** The office checked the bridge after an unconfirmed create: there is no group. */
    readonly confirmNoGroup?: boolean;
    readonly now?: Date;
  },
  db: TransactionalDomainDb,
  ports: { readonly bridge: WhatsAppBridgePort | null | undefined },
): Promise<CreateProjectWhatsAppGroupResult> {
  requireOffice(principal);
  const now = input.now ?? new Date();
  const project = await authorizeProject(principal, input.projectId, db);
  const bridge = requireBridge(ports.bridge);

  const existing = await db.projectWhatsAppGroup.findUnique({
    select: {
      createAttempt: true,
      createdAt: true,
      id: true,
      needsReconciliation: true,
      status: true,
      subject: true,
    },
    where: { projectId: project.id },
  });
  if (existing && LIVE_STATUSES.has(existing.status)) {
    throw new DomainTransitionError(
      "This project already has a WhatsApp group.",
      existing.status,
      ProjectWhatsAppGroupStatus.CREATING,
    );
  }
  if (existing?.status === ProjectWhatsAppGroupStatus.CREATING) {
    // The bridge made it but saving it failed: finish from its answer.
    const receipt = await succeededReceipt(
      db,
      existing.id,
      existing.createAttempt,
    );
    if (receipt) {
      const group = await activate(db, existing.id, receipt, now);
      return {
        group,
        memberCount: receipt.participants.length,
        ownersAsked: receipt.ownersAsked,
      };
    }
    if (
      now.getTime() - existing.createdAt.getTime()
      < GROUP_CREATE_DEADLINE_MS
    ) {
      throw new DomainTransitionError(BEING_CREATED);
    }
    // A request that died mid-way. The bridge may have made the group.
    await db.projectWhatsAppGroup.updateMany({
      data: {
        failureReason: UNCONFIRMED_CREATE_REASON,
        needsReconciliation: true,
        status: ProjectWhatsAppGroupStatus.FAILED,
      },
      where: { id: existing.id, status: ProjectWhatsAppGroupStatus.CREATING },
    });
    throw new DomainTransitionError(
      `The last request for this group never finished. Check Admin › WhatsApp bridge for “${existing.subject}” and link it if it's there; if it isn't, confirm that and create it again.`,
    );
  }
  if (existing?.needsReconciliation && !input.confirmNoGroup) {
    throw new DomainTransitionError(
      `The last create was never confirmed, so “${existing.subject}” may already exist. Check Admin › WhatsApp bridge and link it, or confirm it isn't there to create it again.`,
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
  const fields = {
    failureReason: null,
    inviteLink: null,
    inviteLinkAt: null,
    linkedAt: now,
    needsReconciliation: false,
    origin: ProjectWhatsAppGroupOrigin.CREATED,
    providerGroupId: null,
    status: ProjectWhatsAppGroupStatus.CREATING,
    subject,
  };

  // The claim: one conditional write. A second press that read the same
  // state finds nothing left to claim and is told the group is on its way.
  let rowId: string;
  if (existing) {
    const claimed = await db.projectWhatsAppGroup.updateMany({
      data: { ...fields, createAttempt: { increment: 1 }, createdAt: now },
      where: {
        id: existing.id,
        needsReconciliation: existing.needsReconciliation,
        status: { in: [...RELEASED_STATUSES] },
      },
    });
    if (claimed.count !== 1) throw new DomainTransitionError(BEING_CREATED);
    rowId = existing.id;
    // The old group's members are not members of the new one.
    await db.projectWhatsAppParticipant.deleteMany({
      where: { groupId: rowId },
    });
  } else {
    try {
      const created = await db.projectWhatsAppGroup.create({
        data: {
          ...fields,
          createAttempt: 1,
          createdById: attributionUserId(principal),
          projectId: project.id,
        },
        select: { id: true },
      });
      rowId = created.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainTransitionError(BEING_CREATED);
      }
      throw error;
    }
  }
  const { createAttempt } = await db.projectWhatsAppGroup.findUniqueOrThrow({
    select: { createAttempt: true },
    where: { id: rowId },
  });

  let receipt: CreateReceipt;
  try {
    ({ result: receipt } = await runOutboxEffectWithOutcome<CreateReceipt>(
      db,
      {
        key: createKey(rowId, createAttempt),
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
        if (!created.group.jid) {
          throw new DomainSideEffectError(
            "The WhatsApp bridge answered without the new group's id.",
            "whatsapp",
            false,
          );
        }
        return {
          groupJid: created.group.jid,
          inviteLink: created.inviteLink,
          ownersAsked: ownerPhones.length,
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
        needsReconciliation: !definite,
        status: ProjectWhatsAppGroupStatus.FAILED,
      },
      where: { id: rowId, status: ProjectWhatsAppGroupStatus.CREATING },
    });
    if (error instanceof DomainTransitionError) throw error;
    throw new DomainSideEffectError(reason, "whatsapp", definite, {
      cause: error,
    });
  }

  const group = await activate(db, rowId, receipt, now);
  // Tell the bridge again: a resync that ran while the group was being made
  // could not have known its id. Idempotent; the daily resync backs it up.
  await bridge
    .setMapping(receipt.groupJid, project.id)
    .catch((error: unknown) =>
      console.error(
        `[whatsapp] Could not re-confirm a new group's mapping with the bridge (project ${project.id}); the daily resync repairs it.`,
        error,
      ),
    );
  return {
    group,
    memberCount: receipt.participants.length,
    ownersAsked: ownerPhones.length,
  };
}
