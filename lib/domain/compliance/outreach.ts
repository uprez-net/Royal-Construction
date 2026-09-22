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
  PARTY_OUTREACH_ATTACHMENTS,
} from "@/constants/complianceDocuments";
import { COMPLIANCE_ALERT_PARTY } from "./alert-parties";
import { buildComplianceFollowUpBody } from "./party-outreach-email";
import { partyBlockedReason } from "./prerequisites";
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
    throw new DomainTransitionError("That SLA alert has already been resolved.");
  }
  const party =
    input.party ?? (alert ? COMPLIANCE_ALERT_PARTY[alert.type] : undefined);
  if (!party) return { available: false as const, alert: alert ?? null };

  const outreach = engagement.outreaches.find(
    (candidate) => candidate.party === party,
  );
  const blocked = await partyBlockedReason(engagement, party);
  return {
    available: true as const,
    alert: alert ?? null,
    blocked,
    body: outreachDraftBody(engagement.subjectAddress, party, alert?.detail),
    canSend:
      Boolean(outreach?.contactEmail)
      && outreach?.mode !== ComplianceOutreachMode.SELF_SUPPLIED
      && !blocked,
    daysOpen: alert
      ? Math.max(0, Math.floor((now.getTime() - alert.createdAt.getTime()) / 86_400_000))
      : null,
    outreach: outreach ?? null,
    party,
    subjectAddress: engagement.subjectAddress,
  };
}

export type SendComplianceOutreachInput = {
  readonly body: string;
  readonly contactEmail: string;
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
  readonly idempotencyKey?: string;
  readonly party: CompliancePartyType;
  readonly projectId: string;
};

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
  if (existing?.mode === ComplianceOutreachMode.SELF_SUPPLIED) {
    throw new DomainTransitionError(
      "This party's documents were marked self-supplied; there is no outreach thread to send on.",
    );
  }
  if (existing && existing.status !== ComplianceOutreachStatus.NOT_SENT) {
    return {
      alreadySent: true as const,
      attachmentCount: 0,
      outreachId: existing.id,
      recipient: existing.contactEmail ?? input.contactEmail,
    };
  }

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
            contactEmail: input.contactEmail,
            contactName: input.contactName ?? null,
            contactPhone: input.contactPhone ?? null,
            tradieId: input.tradieId ?? null,
            checklistDocumentId:
              isConsultantParty(input.party) && input.deliverables.length <= 1
                ? ownChecklistId(input.checklistDocumentId)
                : null,
            developerKey: isApprovalParty(input.party)
              ? input.developerKey ?? null
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
            contactEmail: input.contactEmail,
            contactName: input.contactName ?? null,
            contactPhone: input.contactPhone ?? null,
            tradieId: input.tradieId ?? null,
            checklistDocumentId:
              isConsultantParty(input.party) && input.deliverables.length <= 1
                ? ownChecklistId(input.checklistDocumentId)
                : null,
            developerKey: isApprovalParty(input.party)
              ? input.developerKey ?? null
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

  const attachmentTypes = new Set(PARTY_OUTREACH_ATTACHMENTS[input.party]);
  const packFiles = engagement.documents
    .filter((document) => attachmentTypes.has(document.documentType))
    .flatMap((document) => document.files);
  const extras = input.extraAttachmentIds.length
    ? await db.file.findMany({
        where: {
          id: { in: [...input.extraAttachmentIds] },
          OR: [
            { projectId: input.projectId },
            { complianceDocument: { engagement: { projectId: input.projectId } } },
          ],
        },
        select: { id: true, filename: true, fileType: true, url: true },
      })
    : [];
  const packIds = new Set(packFiles.map((file) => file.id));
  const attachments = [
    ...packFiles,
    ...extras.filter((file) => !packIds.has(file.id)),
  ].map((file) => ({ name: file.filename, url: file.url }));

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
        recipient: input.contactEmail,
      },
    },
    async () => {
      await send({
        engagement: { id: engagement.id, subjectAddress: engagement.subjectAddress },
        outreach,
        body: input.body,
        attachments,
      });
      return { outreachId: outreach.id, recipient: input.contactEmail };
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
    recipient: input.contactEmail,
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
  const alert = engagement.alerts.find((candidate) => candidate.id === input.alertId);
  if (!alert || alert.status !== ComplianceAlertStatus.OPEN) {
    throw new DomainTransitionError("That SLA alert is not open on this project.");
  }
  const party = COMPLIANCE_ALERT_PARTY[alert.type];
  if (!party) throw new DomainTransitionError("This SLA alert has no party email follow-up.");
  const outreach = engagement.outreaches.find((candidate) => candidate.party === party);
  if (!outreach?.contactEmail || outreach.mode === ComplianceOutreachMode.SELF_SUPPLIED) {
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
        engagement: { id: engagement.id, subjectAddress: engagement.subjectAddress },
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
            { complianceDocument: { engagement: { projectId: input.projectId } } },
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
