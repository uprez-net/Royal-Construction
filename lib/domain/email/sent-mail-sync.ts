import {
  CertifierEmailDirection,
  type GraphMailbox,
  Prisma,
} from "@prisma/client";

import { recordTradieActivity } from "../audit/tradie-activity-log";
import type { DomainDb } from "../db";
import { DomainAuthorizationError, DomainValidationError } from "../errors";
import { isInternalPrincipal, type DomainPrincipal } from "../principal";
import {
  extractCertifierRefToken,
  isPublicMailDomain,
  subjectMentionsSiteAddress,
} from "@/lib/graph/certifier-subject";
import { isOwnMailbox } from "@/lib/graph/mailbox";
import { extractPartyRefToken } from "@/lib/graph/party-subject";
import { normalizeEmailAddress } from "@/utils/formatters";
import { generateEmailChecksum } from "@/utils/generator";

// Mail somebody typed in Outlook, copied onto the trail of whoever it went to,
// so the app shows the same conversation the mailbox does.
//
// Inbound mail already arrives on the Graph subscription. Outbound mail only
// reaches a trail when the app sent it, so a reply typed in Outlook to a
// certifier, a tradie or a client is missing from the record the office reads
// — and an overdue alert can fire on a party who was answered yesterday. The
// daily sync (lib/workflow/sent-mail-sync.ts) reads Sent Items and hands each
// message here.
//
// Everything below has to be safe to run twice on the same message: the sync
// window overlaps the previous run on purpose, so a missed day is still
// covered, and a workflow step can be replayed.

/**
 * Two rows this far apart on the same trail are taken to be the same send.
 *
 * What the app records itself is stamped `new Date()` just after the send, and
 * what the inbound path records out of a reply's quoted history is stamped from
 * a "Sent:" line with minute precision. Neither carries anything that
 * identifies the Sent Items copy, so time and trail are what is left. Wide
 * enough for both, narrow enough that two separate emails to one person are
 * rarely inside it — and if they are, the cost is one bubble missing from a
 * trail, not a duplicate sent to anybody.
 */
export const SAME_SEND_WINDOW_MS = 5 * 60 * 1000;

/** The tradie entries the app writes when it emails a tradie itself. */
const APP_TRADIE_EMAIL_TYPES = ["requestEmailSent", "bookingEmailSent"];

export type SentMessageInput = {
  readonly graphMessageId: string;
  readonly mailbox: GraphMailbox;
  /** The address it was sent from: the mailbox's own. */
  readonly from: string;
  readonly subject: string;
  /** Only what this message added, not the history it quotes. */
  readonly body: string;
  readonly recipients: readonly string[];
  readonly sentAt: Date;
  /** Stamped by the app's own send; it is already on whichever trail it belongs to. */
  readonly sentByApp: boolean;
  readonly hasAttachments: boolean;
};

export type SentMessageTarget =
  | {
      readonly kind: "compliance";
      readonly engagementId: string;
      /** Null for the certifier's own thread; set for a surveyor, architect or council. */
      readonly outreachId: string | null;
      readonly projectId: string;
      readonly recipient: string;
      readonly matchedOn: "token" | "address";
    }
  | {
      readonly kind: "tradie";
      readonly tradieId: string;
      readonly recipient: string;
    }
  | {
      readonly kind: "lead";
      readonly leadId: number;
      readonly recipient: string;
    };

export type SentMessageFiling = {
  readonly target: SentMessageTarget;
  readonly outcome: "recorded" | "already-recorded";
};

export type SentMessageOutcome =
  | { readonly status: "sent-by-app" }
  /** Nobody it went to is a lead, a tradie or a compliance party we can name. */
  | { readonly status: "unmatched" }
  | {
      readonly status: "filed";
      readonly filings: readonly SentMessageFiling[];
      /** Files stored for the compliance bubbles; leads and tradies keep none. */
      readonly attachments: number;
    };

export type StoredAttachment = { readonly name: string; readonly url: string };

/**
 * Store the message's attachments under a project and answer where they went.
 *
 * Only asked for when a compliance row is about to be written, because that is
 * the only trail that shows files. Must be idempotent per message and project:
 * a replayed step stores the same files at the same paths.
 */
export type SentAttachmentPort = (
  projectId: string,
) => Promise<readonly StoredAttachment[]>;

/**
 * Copy one sent message onto every trail it belongs to.
 *
 * Each recipient is filed once, on the first of: a compliance thread, a
 * tradie, a lead. That is the order the inbound webhook tries them in, for the
 * same reason — a compliance match is the most specific, a lead the least —
 * and an address that is somehow both a tradie and a lead belongs on the
 * tradie's record. A message to several people is filed for each of them: a
 * note to the client copied to the certifier is on both trails.
 */
export async function recordSentMessage(
  principal: DomainPrincipal,
  input: SentMessageInput,
  db: DomainDb,
  ports: { storeAttachments?: SentAttachmentPort } = {},
): Promise<SentMessageOutcome> {
  if (!isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Copying sent mail onto a trail requires internal staff access.",
    );
  }
  if (!input.graphMessageId) {
    throw new DomainValidationError(
      "A sent message needs its Graph id.",
      "graphMessageId",
    );
  }
  if (Number.isNaN(input.sentAt.getTime())) {
    throw new DomainValidationError(
      "A sent message needs the time it was sent.",
      "sentAt",
    );
  }
  if (input.sentByApp) {
    return { status: "sent-by-app" };
  }

  const recipients = [
    ...new Set(input.recipients.map(normalizeEmailAddress).filter(Boolean)),
  ].filter((address) => !isOwnMailbox(address));
  if (recipients.length === 0) {
    return { status: "unmatched" };
  }

  const targets = await resolveTargets(input, recipients, db);
  if (targets.length === 0) {
    return { status: "unmatched" };
  }

  const from = normalizeEmailAddress(input.from);
  const storedByProject = new Map<string, readonly StoredAttachment[]>();
  const filings: SentMessageFiling[] = [];

  for (const target of targets) {
    switch (target.kind) {
      case "compliance": {
        if (await complianceRowExists(target, input.sentAt, db)) {
          filings.push({ target, outcome: "already-recorded" });
          break;
        }
        let attachments = storedByProject.get(target.projectId);
        if (!attachments) {
          attachments =
            input.hasAttachments && ports.storeAttachments
              ? await ports.storeAttachments(target.projectId)
              : [];
          storedByProject.set(target.projectId, attachments);
        }
        const created = await db.certifierEmail.createMany({
          data: [
            {
              engagementId: target.engagementId,
              outreachId: target.outreachId,
              emailFrom: from,
              emailTo: target.recipient,
              subject: input.subject,
              body: input.body,
              checksum: await generateEmailChecksum(
                input.subject,
                input.body,
                from,
                target.recipient,
              ),
              direction: CertifierEmailDirection.OUTBOUND,
              graphMailbox: input.mailbox,
              attachments: attachments as unknown as Prisma.InputJsonValue,
              sentAt: input.sentAt,
            },
          ],
          skipDuplicates: true,
        });
        filings.push({
          target,
          outcome: created.count > 0 ? "recorded" : "already-recorded",
        });
        break;
      }

      case "tradie": {
        const existing = await db.tradieActivityLog.findFirst({
          select: { id: true },
          where: {
            tradieId: target.tradieId,
            OR: [
              // This sync's own entry, which is stamped at the send time
              // exactly — the key a replay finds.
              { type: "outlookEmailSent", createdAt: input.sentAt },
              {
                type: { in: APP_TRADIE_EMAIL_TYPES },
                createdAt: sameSendWindow(input.sentAt),
              },
            ],
          },
        });
        if (existing) {
          filings.push({ target, outcome: "already-recorded" });
          break;
        }
        await recordTradieActivity(
          {
            at: input.sentAt,
            data: { subject: input.subject, tradieId: target.tradieId },
            principal,
            type: "outlookEmailSent",
          },
          db,
        );
        filings.push({ target, outcome: "recorded" });
        break;
      }

      case "lead": {
        const existing = await db.leadEmails.findFirst({
          select: { id: true },
          where: {
            leadId: target.leadId,
            emailTo: target.recipient,
            sentAt: sameSendWindow(input.sentAt),
          },
        });
        if (existing) {
          filings.push({ target, outcome: "already-recorded" });
          break;
        }
        const created = await db.leadEmails.createMany({
          data: [
            {
              leadId: target.leadId,
              emailFrom: from,
              emailTo: target.recipient,
              subject: input.subject,
              body: input.body,
              // The key every other writer to this table uses, so a reply
              // that later quotes this message converges on this row.
              checksum: await generateEmailChecksum(
                input.subject,
                input.body,
                from,
                target.recipient,
              ),
              sentAt: input.sentAt,
            },
          ],
          skipDuplicates: true,
        });
        filings.push({
          target,
          outcome: created.count > 0 ? "recorded" : "already-recorded",
        });
        break;
      }
    }
  }

  return {
    status: "filed",
    filings,
    attachments: [...storedByProject.values()].reduce(
      (sum, stored) => sum + stored.length,
      0,
    ),
  };
}

function sameSendWindow(sentAt: Date) {
  return {
    gte: new Date(sentAt.getTime() - SAME_SEND_WINDOW_MS),
    lte: new Date(sentAt.getTime() + SAME_SEND_WINDOW_MS),
  };
}

async function complianceRowExists(
  target: Extract<SentMessageTarget, { kind: "compliance" }>,
  sentAt: Date,
  db: DomainDb,
): Promise<boolean> {
  const row = await db.certifierEmail.findFirst({
    select: { id: true },
    where: {
      engagementId: target.engagementId,
      outreachId: target.outreachId,
      direction: CertifierEmailDirection.OUTBOUND,
      sentAt: sameSendWindow(sentAt),
    },
  });
  return row !== null;
}

async function resolveTargets(
  input: SentMessageInput,
  recipients: readonly string[],
  db: DomainDb,
): Promise<SentMessageTarget[]> {
  const targets: SentMessageTarget[] = [];
  const remaining = new Set(recipients);

  const compliance = await matchCompliance(input, recipients, db);
  if (compliance) {
    targets.push(compliance);
    remaining.delete(compliance.recipient);
  }

  if (remaining.size > 0) {
    const tradies = await db.tradie.findMany({
      select: { id: true, email: true, additionalEmails: true },
      where: {
        OR: [
          { email: { in: [...remaining], mode: "insensitive" } },
          { additionalEmails: { hasSome: [...remaining] } },
        ],
      },
    });
    for (const recipient of [...remaining]) {
      const tradie = tradies.find((candidate) =>
        [candidate.email, ...candidate.additionalEmails].some(
          (address) => normalizeEmailAddress(address) === recipient,
        ),
      );
      if (tradie) {
        targets.push({ kind: "tradie", tradieId: tradie.id, recipient });
        remaining.delete(recipient);
      }
    }
  }

  if (remaining.size > 0) {
    // Newest first, so where two leads share an address the trail goes on the
    // one being worked. Matched on the primary email only: the identity the
    // inbound path (lib/leads/existing-lead.ts) recognises a lead by.
    const leads = await db.lead.findMany({
      select: { id: true, email: true },
      where: { email: { in: [...remaining], mode: "insensitive" } },
      orderBy: { id: "desc" },
    });
    for (const recipient of remaining) {
      const lead = leads.find(
        (candidate) => normalizeEmailAddress(candidate.email) === recipient,
      );
      if (lead) {
        targets.push({ kind: "lead", leadId: lead.id, recipient });
      }
    }
  }

  return targets;
}

/**
 * The one compliance thread a sent message belongs to, if any.
 *
 * The correlation the inbound webhook makes in `matchPartyOutreach` and
 * `matchCertifierEngagement` (app/api/graph/notifications/route.ts): our
 * token where the subject carries one, else the recipient's address — exact
 * on a public mail domain, the office's domain otherwise — together with the
 * site address in the subject, and only when exactly one thread fits. One
 * deliberate difference: inbound also requires that the thread has already had
 * an outbound message, because a party nobody has written to cannot be
 * replying. Here we are the ones writing, so a first email typed in Outlook is
 * exactly the one this has to find.
 */
async function matchCompliance(
  input: SentMessageInput,
  recipients: readonly string[],
  db: DomainDb,
): Promise<Extract<SentMessageTarget, { kind: "compliance" }> | null> {
  const partyToken = extractPartyRefToken(input.subject);
  if (partyToken) {
    const outreach = await db.complianceOutreach.findFirst({
      select: {
        id: true,
        engagementId: true,
        contactEmail: true,
        engagement: { select: { projectId: true } },
      },
      where: { refToken: partyToken, graphMailbox: input.mailbox },
    });
    if (!outreach) return null;
    return {
      kind: "compliance",
      engagementId: outreach.engagementId,
      outreachId: outreach.id,
      projectId: outreach.engagement.projectId,
      recipient: pickRecipient(recipients, outreach.contactEmail),
      matchedOn: "token",
    };
  }

  const certifierToken = extractCertifierRefToken(input.subject);
  if (certifierToken) {
    const engagement = await db.certifierEngagement.findFirst({
      select: { id: true, projectId: true, certifierEmail: true },
      where: { refToken: certifierToken, graphMailbox: input.mailbox },
    });
    if (!engagement) return null;
    return {
      kind: "compliance",
      engagementId: engagement.id,
      outreachId: null,
      projectId: engagement.projectId,
      recipient: pickRecipient(recipients, engagement.certifierEmail),
      matchedOn: "token",
    };
  }

  const addressFilters = recipients.map((recipient) => {
    const domain = recipient.slice(recipient.indexOf("@") + 1);
    return isPublicMailDomain(domain)
      ? { equals: recipient, mode: "insensitive" as const }
      : { endsWith: `@${domain}`, mode: "insensitive" as const };
  });

  const [engagements, outreaches] = await Promise.all([
    db.certifierEngagement.findMany({
      select: {
        id: true,
        projectId: true,
        certifierEmail: true,
        subjectAddress: true,
      },
      where: {
        graphMailbox: input.mailbox,
        OR: addressFilters.map((certifierEmail) => ({ certifierEmail })),
      },
    }),
    db.complianceOutreach.findMany({
      select: {
        id: true,
        engagementId: true,
        contactEmail: true,
        engagement: { select: { projectId: true, subjectAddress: true } },
      },
      where: {
        graphMailbox: input.mailbox,
        OR: addressFilters.map((contactEmail) => ({ contactEmail })),
      },
    }),
  ]);

  const matches: Extract<SentMessageTarget, { kind: "compliance" }>[] = [
    ...engagements
      .filter((engagement) =>
        subjectMentionsSiteAddress(input.subject, engagement.subjectAddress),
      )
      .map((engagement) => ({
        kind: "compliance" as const,
        engagementId: engagement.id,
        outreachId: null,
        projectId: engagement.projectId,
        recipient: pickRecipient(recipients, engagement.certifierEmail),
        matchedOn: "address" as const,
      })),
    ...outreaches
      .filter((outreach) =>
        subjectMentionsSiteAddress(
          input.subject,
          outreach.engagement.subjectAddress,
        ),
      )
      .map((outreach) => ({
        kind: "compliance" as const,
        engagementId: outreach.engagementId,
        outreachId: outreach.id,
        projectId: outreach.engagement.projectId,
        recipient: pickRecipient(recipients, outreach.contactEmail),
        matchedOn: "address" as const,
      })),
  ];

  // Two of our jobs on one subject — two units at the same address, most
  // likely. Filing it against the wrong project is worse than not filing it.
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The recipient the thread is addressed to; else someone at the same office,
 * which is what an address match on the domain found; else whoever it went to
 * first, for a token match on a forward.
 */
function pickRecipient(
  recipients: readonly string[],
  threadAddress: string | null | undefined,
): string {
  const wanted = normalizeEmailAddress(threadAddress ?? "");
  const domain = wanted.slice(wanted.indexOf("@") + 1);
  return (
    recipients.find((recipient) => recipient === wanted)
    ?? (domain && !isPublicMailDomain(domain)
      ? recipients.find((recipient) => recipient.endsWith(`@${domain}`))
      : undefined)
    ?? recipients[0]
  );
}
