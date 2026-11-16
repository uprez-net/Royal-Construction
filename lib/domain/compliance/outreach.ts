import {
  ComplianceAlertStatus,
  ComplianceDocumentType,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
  GraphMailbox,
  OutboxEventKind,
} from "@prisma/client";

import {
  isApprovalParty,
  isConsultantParty,
  PARTY_LABEL,
  outreachPackFiles,
  PARTY_TRADE_LABEL,
} from "@/constants/complianceDocuments";
import { AREA_DEVELOPERS } from "@/constants/complianceDevelopers";
import { COMPLIANCE_ALERT_PARTY } from "./alert-parties";
import { buildComplianceFollowUpBody } from "./party-outreach-email";
import {
  consultantNotAskedForReason,
  partyBlockedReason,
} from "./prerequisites";
import { generatePartyRefToken } from "@/lib/graph/party-subject";
import { certifierEngagementInclude } from "@/types/compliance";
import { generateEmailChecksum } from "@/utils/generator";

import { authorizeComplianceAccess } from "../access/compliance";
import type { DomainDb, TransactionalDomainDb } from "../db";
import {
  DomainNotFoundError,
  DomainTransitionError,
  DomainValidationError,
} from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import {
  tradieCoversTrade,
  tradieInTradeWhere,
  tradieTrades,
} from "../tradies/request-rules";
import type { DomainPrincipal } from "../principal";

export type ComplianceAttachment = {
  readonly id: string;
  readonly filename: string;
  readonly fileType: string;
  readonly url: string;
};

export type ComplianceEmailPort = (input: {
  readonly engagement: { id: string; subjectAddress: string };
  readonly outreach: {
    id: string;
    refToken: string;
    contactEmail: string | null;
    lastInboundMessageId: string | null;
    graphMailbox: GraphMailbox;
  };
  readonly body: string;
  readonly attachments: readonly { name: string; url: string }[];
}) => Promise<void>;

export async function recordCompliancePartySelfSupplied(
  principal: DomainPrincipal,
  input: { party: CompliancePartyType; projectId: string },
  db: DomainDb,
) {
  await authorizeComplianceAccess(principal, input.projectId, db);
  const engagement = await requireEngagement(input.projectId, db);
  const existing = engagement.outreaches.find(
    (candidate) => candidate.party === input.party,
  );
  if (existing) return { created: false as const, outreach: existing };
  const blocked = await partyBlockedReason(engagement, input.party);
  if (blocked) throw new DomainTransitionError(blocked);
  const outreach = await db.complianceOutreach.upsert({
    where: {
      engagementId_party: {
        engagementId: engagement.id,
        party: input.party,
      },
    },
    update: {},
    create: {
      engagementId: engagement.id,
      party: input.party,
      refToken: generatePartyRefToken(input.party),
      mode: ComplianceOutreachMode.SELF_SUPPLIED,
      status: ComplianceOutreachStatus.NOT_SENT,
      graphMailbox: GraphMailbox.ADMIN,
    },
  });
  return { created: true as const, outreach };
}

async function requireEngagement(projectId: string, db: DomainDb) {
  const engagement = await db.certifierEngagement.findUnique({
    where: { projectId },
    include: certifierEngagementInclude,
  });
  if (!engagement) {
    throw new DomainNotFoundError(
      "This project has no compliance engagement yet.",
    );
  }
  return engagement;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function outreachDraftBody(
  subjectAddress: string,
  party: CompliancePartyType,
  alertDetail?: string | null,
) {
  const label = PARTY_LABEL[party];
  const detail = alertDetail
    ? `<p>${escapeHtml(alertDetail)}</p>`
    : "<p>Could you please provide an update and let us know when we can expect the outstanding information?</p>";
  return `<p>Hi,</p><p>We are following up regarding the ${label.toLowerCase()} requirements for <strong>${escapeHtml(subjectAddress)}</strong>.</p>${detail}<p>Please keep the project reference in the subject line on any reply.</p><p>Kind regards,<br/>Royal Constructions</p>`;
}

export async function prepareComplianceOutreach(
  principal: DomainPrincipal,
  input: { alertId?: string; party?: CompliancePartyType; projectId: string },
  db: DomainDb,
  now = new Date(),
) {
  await authorizeComplianceAccess(principal, input.projectId, db);
  const engagement = await requireEngagement(input.projectId, db);
  const alert = input.alertId
    ? engagement.alerts.find((candidate) => candidate.id === input.alertId)
    : undefined;
  if (input.alertId && !alert) {
    throw new DomainNotFoundError("That SLA alert is not on this project.");
  }
  if (alert && alert.status !== ComplianceAlertStatus.OPEN) {
    throw new DomainTransitionError(
      "That SLA alert has already been resolved.",
    );
  }
  const party =
    input.party ?? (alert ? COMPLIANCE_ALERT_PARTY[alert.type] : undefined);
  if (!party) return { available: false as const, alert: alert ?? null };

  const outreach = engagement.outreaches.find(
    (candidate) => candidate.party === party,
  );
  const blocked =
    (await partyBlockedReason(engagement, party))
    ?? selfSuppliedReason(outreach)
    ?? (alert
      ? null
      : (consultantNotAskedForReason(
          engagement,
          party,
          outreach?.checklistDocumentId ? [outreach.checklistDocumentId] : [],
        )
        // An opening outreach on a party already written to would email
        // nobody (the send answers alreadySent), so it is not worth an approval.
        ?? (outreach && outreach.status !== ComplianceOutreachStatus.NOT_SENT
          ? `The ${PARTY_LABEL[party].toLowerCase()} was already written to at ${outreach.contactEmail ?? "an address on file"}; send a follow-up instead of a new outreach.`
          : null)));
  return {
    available: true as const,
    alert: alert ?? null,
    blocked,
    // An SLA follow-up carries no files (sendComplianceFollowUp sends none), so
    // only an opening outreach has a pack to list.
    attachments: alert
      ? []
      : await outreachAttachments(
          engagement,
          {
            extraAttachmentIds: [],
            omitAttachmentIds: [],
            party,
            projectId: input.projectId,
          },
          db,
        ),
    candidates: await outreachCandidates(party, db),
    body: outreachDraftBody(engagement.subjectAddress, party, alert?.detail),
    canSend:
      Boolean(outreach?.contactEmail)
      && outreach?.mode !== ComplianceOutreachMode.SELF_SUPPLIED
      && !blocked,
    daysOpen: alert
      ? Math.max(
          0,
          Math.floor((now.getTime() - alert.createdAt.getTime()) / 86_400_000),
        )
      : null,
    outreach: outreach ?? null,
    party,
    subjectAddress: engagement.subjectAddress,
  };
}

/** One rule, asked by prepare (so Eve never requests the approval) and by send. */
function selfSuppliedReason(
  outreach: { mode: ComplianceOutreachMode } | null | undefined,
): string | null {
  return outreach?.mode === ComplianceOutreachMode.SELF_SUPPLIED
    ? "This party's documents were marked self-supplied; there is no outreach thread to send on."
    : null;
}

export type SendComplianceOutreachInput = {
  readonly body: string;
  /**
   * Which of the picked contact's addresses to write to. For a directory party
   * it must be one of that tradie's own addresses, and defaults to the primary
   * one; for the estate developer it is whatever the operator entered, since
   * most estates have no address on file.
   */
  readonly contactEmail?: string;
  readonly contactName?: string;
  readonly contactPhone?: string;
  readonly tradieId?: string;
  readonly developerKey?: string;
  readonly checklistDocumentId?: string;
  readonly deliverables: readonly {
    checklistDocumentId?: string;
    documentType: ComplianceDocumentType;
  }[];
  readonly extraAttachmentIds: readonly string[];
  /**
   * Files of the party's standard pack to leave off this email. The pack is
   * added automatically, so without this the owner who asked for "no
   * attachments" had no way to say it (#366).
   */
  readonly omitAttachmentIds?: readonly string[];
  readonly idempotencyKey?: string;
  readonly party: CompliancePartyType;
  readonly projectId: string;
};

type OutreachEngagement = Awaited<ReturnType<typeof requireEngagement>>;

/**
 * Every file an opening outreach will carry: the party's standard pack, then
 * the extras asked for that belong to this project, less anything omitted. The
 * send, Eve's prepare step and the approval card all call this, so the list the
 * owner approves is the list that goes out.
 */
export async function outreachAttachments(
  engagement: OutreachEngagement,
  input: Pick<
    SendComplianceOutreachInput,
    "extraAttachmentIds" | "omitAttachmentIds" | "party" | "projectId"
  >,
  db: DomainDb,
) {
  const packFiles = outreachPackFiles(engagement.documents, input.party);
  const extras = input.extraAttachmentIds.length
    ? await db.file.findMany({
        where: {
          id: { in: [...input.extraAttachmentIds] },
          OR: [
            { projectId: input.projectId },
            {
              complianceDocument: {
                engagement: { projectId: input.projectId },
              },
            },
          ],
        },
        select: { id: true, filename: true, fileType: true, url: true },
      })
    : [];
  const omitted = new Set(input.omitAttachmentIds ?? []);
  const packIds = new Set(packFiles.map((file) => file.id));
  return [...packFiles, ...extras.filter((file) => !packIds.has(file.id))]
    .filter((file) => !omitted.has(file.id))
    .map((file) => ({ id: file.id, name: file.filename, url: file.url }));
}

/**
 * The file names an outreach would carry, for the approval card. Names only:
 * a blob URL is a credential for the file. Authorised like the send itself.
 */
export async function previewOutreachAttachments(
  principal: DomainPrincipal,
  input: Pick<
    SendComplianceOutreachInput,
    "extraAttachmentIds" | "omitAttachmentIds" | "party" | "projectId"
  >,
  db: DomainDb,
): Promise<string[]> {
  await authorizeComplianceAccess(principal, input.projectId, db);
  const engagement = await requireEngagement(input.projectId, db);
  return (await outreachAttachments(engagement, input, db)).map(
    (file) => file.name,
  );
}

/** Persist, deliver and settle one opening party email through a durable key. */
export async function sendComplianceOutreach(
  principal: DomainPrincipal,
  input: SendComplianceOutreachInput,
  db: TransactionalDomainDb,
  send: ComplianceEmailPort,
) {
  await authorizeComplianceAccess(principal, input.projectId, db);
  const engagement = await requireEngagement(input.projectId, db);
  const blocked = await partyBlockedReason(engagement, input.party);
  if (blocked) throw new DomainTransitionError(blocked);
  if (!input.body.replace(/<[^>]*>/g, "").trim()) {
    throw new DomainValidationError("The email body cannot be empty.", "body");
  }

  const existing = engagement.outreaches.find(
    (candidate) => candidate.party === input.party,
  );
  const selfSupplied = selfSuppliedReason(existing);
  if (selfSupplied) throw new DomainTransitionError(selfSupplied);
  if (existing && existing.status !== ComplianceOutreachStatus.NOT_SENT) {
    return {
      alreadySent: true as const,
      attachmentCount: 0,
      outreachId: existing.id,
      // Who it actually went to. The address asked for this time was not
      // emailed, so naming it here would report a send that never happened.
      recipient: existing.contactEmail ?? "",
    };
  }

  const notAskedFor = consultantNotAskedForReason(engagement, input.party, [
    ...(input.checklistDocumentId ? [input.checklistDocumentId] : []),
    ...input.deliverables.flatMap((item) =>
      item.checklistDocumentId ? [item.checklistDocumentId] : [],
    ),
  ]);
  if (notAskedFor) throw new DomainTransitionError(notAskedFor);
  const recipient = await resolveOutreachRecipient(input, db);

  const ownDocumentIds = new Set(
    engagement.documents.map((document) => document.id),
  );
  const ownChecklistId = (id: string | undefined) =>
    id && ownDocumentIds.has(id) ? id : null;

  const outreach = await db.$transaction(async (tx) => {
    const stored = existing
      ? await tx.complianceOutreach.update({
          where: { id: existing.id },
          data: {
            contactEmail: recipient.contactEmail,
            contactName: recipient.contactName,
            contactPhone: recipient.contactPhone,
            tradieId: recipient.tradieId,
            checklistDocumentId:
              isConsultantParty(input.party) && input.deliverables.length <= 1
                ? ownChecklistId(input.checklistDocumentId)
                : null,
            developerKey: isApprovalParty(input.party)
              ? (input.developerKey ?? null)
              : null,
          },
        })
      : await tx.complianceOutreach.create({
          data: {
            engagementId: engagement.id,
            party: input.party,
            refToken: generatePartyRefToken(input.party),
            mode: ComplianceOutreachMode.OUTREACH,
            status: ComplianceOutreachStatus.NOT_SENT,
            graphMailbox: GraphMailbox.ADMIN,
            contactEmail: recipient.contactEmail,
            contactName: recipient.contactName,
            contactPhone: recipient.contactPhone,
            tradieId: recipient.tradieId,
            checklistDocumentId:
              isConsultantParty(input.party) && input.deliverables.length <= 1
                ? ownChecklistId(input.checklistDocumentId)
                : null,
            developerKey: isApprovalParty(input.party)
              ? (input.developerKey ?? null)
              : null,
          },
        });
    await tx.complianceOutreachDeliverable.deleteMany({
      where: { outreachId: stored.id },
    });
    if (input.deliverables.length > 0) {
      await tx.complianceOutreachDeliverable.createMany({
        data: input.deliverables.map((item) => ({
          outreachId: stored.id,
          documentType: item.documentType,
          checklistDocumentId: ownChecklistId(item.checklistDocumentId),
        })),
        skipDuplicates: true,
      });
    }
    return stored;
  });

  const attachments = (await outreachAttachments(engagement, input, db)).map(
    (file) => ({ name: file.name, url: file.url }),
  );

  const { replayed } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `compliance-email:${input.idempotencyKey?.trim() || `${outreach.id}:opening`}`,
      kind: OutboxEventKind.COMPLIANCE_EMAIL_SEND,
      payload: {
        attachmentCount: attachments.length,
        outreachId: outreach.id,
        party: input.party,
        projectId: input.projectId,
        recipient: recipient.contactEmail,
      },
    },
    async () => {
      await send({
        engagement: {
          id: engagement.id,
          subjectAddress: engagement.subjectAddress,
        },
        outreach,
        body: input.body,
        attachments,
      });
      return { outreachId: outreach.id, recipient: recipient.contactEmail };
    },
  );
  await db.complianceOutreach.updateMany({
    where: { id: outreach.id, status: ComplianceOutreachStatus.NOT_SENT },
    data: { status: ComplianceOutreachStatus.SENT, sentAt: new Date() },
  });
  return {
    alreadySent: replayed,
    attachmentCount: attachments.length,
    outreachId: outreach.id,
    recipient: recipient.contactEmail,
  };
}

/**
 * Who an opening outreach for this party may go to: that party's trade in the
 * tradie directory, the same list the compliance tab's contact picker offers.
 * Empty for the developer (picked by estate) and the council (never written to).
 */
async function outreachCandidates(party: CompliancePartyType, db: DomainDb) {
  const trade = PARTY_TRADE_LABEL[party];
  if (trade === null) return [];
  return db.tradie.findMany({
    orderBy: [{ isFavourite: "desc" }, { name: "asc" }],
    select: { additionalEmails: true, email: true, id: true, name: true },
    take: 25,
    where: { archivedAt: null, ...tradieInTradeWhere(trade) },
  });
}

type OutreachRecipient = {
  readonly contactEmail: string;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly tradieId: string | null;
};

/**
 * Who an opening outreach goes to, from the fixed list for its party.
 *
 * Every directory party is engaged from the one trade it is picked from
 * (`PARTY_TRADE_LABEL`), which is what the compliance tab's contact picker
 * offers. The send used to trust whatever address it was handed, so an outreach
 * could go to anyone at all — the tab never allowed that, and Eve could. Now
 * the tradie must be on that party's list, and the address must be one of that
 * tradie's own.
 *
 * The estate developer is picked from `AREA_DEVELOPERS` instead. Most estates
 * have no address on file, so the operator supplies one; what is checked is
 * that the estate is a known one. The council is never written to from here.
 */
async function resolveOutreachRecipient(
  input: SendComplianceOutreachInput,
  db: DomainDb,
): Promise<OutreachRecipient> {
  const label = PARTY_LABEL[input.party];
  const trade = PARTY_TRADE_LABEL[input.party];
  const typedEmail = input.contactEmail?.trim().toLowerCase() || null;

  if (trade === null) {
    if (!isApprovalParty(input.party)) {
      throw new DomainTransitionError(`Nothing is sent to ${label} from here.`);
    }
    const developer = AREA_DEVELOPERS.find(
      (candidate) => candidate.key === input.developerKey,
    );
    if (!developer) {
      throw new DomainValidationError(
        "Choose the estate developer from the developer list.",
        "developerKey",
      );
    }
    const email = typedEmail ?? developer.contactEmail?.trim().toLowerCase();
    if (!email) {
      throw new DomainValidationError(
        `There is no address on file for ${developer.name}; enter the developer's email.`,
        "contactEmail",
      );
    }
    return {
      contactEmail: email,
      contactName: input.contactName ?? developer.name,
      contactPhone: input.contactPhone ?? null,
      tradieId: null,
    };
  }

  if (!input.tradieId) {
    throw new DomainValidationError(
      `Choose the ${label.toLowerCase()} from the ${trade} list in the tradie directory.`,
      "tradieId",
    );
  }
  const tradie = await db.tradie.findUnique({
    select: {
      archivedAt: true,
      additionalEmails: true,
      email: true,
      id: true,
      name: true,
      phone: true,
      trade: true,
      trades: true,
    },
    where: { id: input.tradieId },
  });
  if (!tradie || tradie.archivedAt) {
    throw new DomainNotFoundError("That tradie is not in the directory.");
  }
  if (!tradieCoversTrade(tradie, trade)) {
    throw new DomainValidationError(
      `${tradie.name} is listed under ${tradieTrades(tradie).join(", ") || "no trade"}, not ${trade}. Choose the ${label.toLowerCase()} from the ${trade} list.`,
      "tradieId",
    );
  }
  const addresses = [tradie.email, ...tradie.additionalEmails]
    .map((address) => address.trim().toLowerCase())
    .filter((address) => address.length > 0);
  if (addresses.length === 0) {
    throw new DomainValidationError(
      `${tradie.name} has no email address in the directory. Add one to their directory entry first.`,
      "contactEmail",
    );
  }
  const email = typedEmail ?? addresses[0];
  if (!addresses.includes(email)) {
    throw new DomainValidationError(
      `${typedEmail} is not one of ${tradie.name}'s addresses in the directory.`,
      "contactEmail",
    );
  }
  return {
    contactEmail: email,
    contactName: input.contactName ?? tradie.name,
    contactPhone: input.contactPhone ?? tradie.phone,
    tradieId: tradie.id,
  };
}

export async function sendComplianceFollowUp(
  principal: DomainPrincipal,
  input: {
    alertId: string;
    body?: string;
    idempotencyKey?: string;
    projectId: string;
    now?: Date;
  },
  db: DomainDb,
  send: ComplianceEmailPort,
) {
  await authorizeComplianceAccess(principal, input.projectId, db);
  const engagement = await requireEngagement(input.projectId, db);
  const alert = engagement.alerts.find(
    (candidate) => candidate.id === input.alertId,
  );
  if (!alert || alert.status !== ComplianceAlertStatus.OPEN) {
    throw new DomainTransitionError(
      "That SLA alert is not open on this project.",
    );
  }
  const party = COMPLIANCE_ALERT_PARTY[alert.type];
  if (!party)
    throw new DomainTransitionError(
      "This SLA alert has no party email follow-up.",
    );
  const outreach = engagement.outreaches.find(
    (candidate) => candidate.party === party,
  );
  if (
    !outreach?.contactEmail
    || outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED
  ) {
    throw new DomainTransitionError(
      `No sendable ${PARTY_LABEL[party].toLowerCase()} thread is available.`,
    );
  }
  const body = input.body?.replace(/<[^>]*>/g, "").trim()
    ? input.body
    : buildComplianceFollowUpBody({
        alert,
        engagement,
        outreach,
        subjectAddress: engagement.subjectAddress,
      });
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  const { replayed } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `compliance-email:${input.idempotencyKey?.trim() || `${outreach.id}:follow-up:${alert.id}:${day}`}`,
      kind: OutboxEventKind.COMPLIANCE_EMAIL_SEND,
      payload: {
        alertId: alert.id,
        outreachId: outreach.id,
        party,
        projectId: input.projectId,
        recipient: outreach.contactEmail,
      },
    },
    async () => {
      await send({
        engagement: {
          id: engagement.id,
          subjectAddress: engagement.subjectAddress,
        },
        outreach,
        body,
        attachments: [],
      });
      return { alertId: alert.id, outreachId: outreach.id };
    },
  );
  await db.complianceOutreach.update({
    where: { id: outreach.id },
    data: { lastFollowUpAt: new Date() },
  });
  return {
    alertId: alert.id,
    alertType: alert.type,
    alreadySent: replayed,
    engagementId: engagement.id,
    party,
    recipient: outreach.contactEmail,
  };
}

export async function sendCompliancePartyReply(
  principal: DomainPrincipal,
  input: {
    attachments: readonly { fileId: string; name: string; url: string }[];
    body: string;
    extraAttachmentIds: readonly string[];
    idempotencyKey?: string;
    outreachId: string;
    projectId: string;
  },
  db: DomainDb,
  send: ComplianceEmailPort,
) {
  await authorizeComplianceAccess(principal, input.projectId, db);
  const engagement = await requireEngagement(input.projectId, db);
  const outreach = engagement.outreaches.find(
    (candidate) => candidate.id === input.outreachId,
  );
  if (!outreach) {
    throw new DomainNotFoundError("No such outreach on this compliance file.");
  }
  if (!outreach.contactEmail) {
    throw new DomainTransitionError(
      `The ${PARTY_LABEL[outreach.party].toLowerCase()} documents were supplied by the client — there is no thread to reply on.`,
    );
  }
  if (!input.body.replace(/<[^>]*>/g, "").trim()) {
    throw new DomainValidationError("The message cannot be empty.", "body");
  }
  const extras = input.extraAttachmentIds.length
    ? await db.file.findMany({
        where: {
          id: { in: [...input.extraAttachmentIds] },
          OR: [
            { projectId: input.projectId },
            {
              complianceDocument: {
                engagement: { projectId: input.projectId },
              },
            },
          ],
        },
        select: { id: true, filename: true, url: true },
      })
    : [];
  const requested = [
    ...input.attachments.map((file) => ({
      fileId: file.fileId,
      name: file.name,
      url: file.url,
    })),
    ...extras.map((file) => ({
      fileId: file.id,
      name: file.filename,
      url: file.url,
    })),
  ].filter(
    (file, index, all) =>
      all.findIndex((candidate) => candidate.fileId === file.fileId) === index,
  );
  const fingerprint = await generateEmailChecksum(
    input.outreachId,
    `${input.body}\n${requested.map((file) => file.fileId).join(",")}`,
    "",
    outreach.contactEmail,
  );
  const { replayed } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `compliance-email:${input.idempotencyKey?.trim() || `${outreach.id}:reply:${fingerprint}`}`,
      kind: OutboxEventKind.COMPLIANCE_EMAIL_SEND,
      payload: {
        attachmentCount: requested.length,
        outreachId: outreach.id,
        party: outreach.party,
        projectId: input.projectId,
        recipient: outreach.contactEmail,
      },
    },
    async () => {
      await send({
        engagement: {
          id: engagement.id,
          subjectAddress: engagement.subjectAddress,
        },
        outreach,
        body: input.body,
        attachments: requested,
      });
      return { outreachId: outreach.id, recipient: outreach.contactEmail! };
    },
  );
  return {
    alreadySent: replayed,
    attachmentCount: requested.length,
    outreachId: outreach.id,
    recipient: outreach.contactEmail,
  };
}
