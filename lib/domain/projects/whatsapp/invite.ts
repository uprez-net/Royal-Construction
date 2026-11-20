import { createHash } from "node:crypto";

import { OutboxEventKind, ProjectWhatsAppGroupStatus } from "@prisma/client";

import {
  EMAIL_FOOTER_HTML,
  EMAIL_HEADER_HTML,
} from "@/constants/email-artifacts";
import { FONTS, RC_COLORS } from "@/lib/graph/Email/email-theme";

import { authorizeProject } from "../../access/projects";
import type { DomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "../../errors";
import { runOutboxEffectWithOutcome } from "../../outbox";
import { isInternalPrincipal, type DomainPrincipal } from "../../principal";
import {
  ownerEmailRecipients,
  PROJECT_OWNER_SELECT,
  projectOwnerRows,
} from "../owners";

// Inviting a project's owners into its WhatsApp group, by email.
//
// This reaches a client, so the rules are strict and live here once:
//
//   - only to the owners on the contract — the same list variations email
//     (`ownerEmailRecipients`), never an address typed in;
//   - only for a group that exists, with the link the email carries being the
//     group's current one — an edited-away or stale link would invite nobody,
//     and the office would believe it had;
//   - once per intent: the composer's idempotency key names it, so a
//     double-click is one email and a deliberate re-send is another.
//
// The office edits the wording before it goes; the draft is only a start.

export const MAX_INVITE_SUBJECT_LENGTH = 200;
export const MAX_INVITE_BODY_LENGTH = 10_000;

export type ProjectWhatsAppInviteDraft = {
  /** The owners who can be emailed, all chosen by default. */
  readonly recipients: readonly { email: string; name: string }[];
  readonly subject: string;
  /** Plain text. The signature is added when it is sent. */
  readonly body: string;
  readonly inviteLink: string;
};

function requireStaffUser(principal: DomainPrincipal) {
  if (principal.kind !== "user" || !isInternalPrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Emailing a project's owners requires a signed-in member of staff.",
    );
  }
  return principal;
}

async function loadInviteContext(
  principal: DomainPrincipal,
  projectId: string,
  db: DomainDb,
) {
  await authorizeProject(principal, projectId, db);
  const project = await db.project.findUniqueOrThrow({
    select: {
      ...PROJECT_OWNER_SELECT,
      id: true,
      leadId: true,
      location: true,
      name: true,
      whatsappGroup: { select: { inviteLink: true, status: true } },
    },
    where: { id: projectId },
  });
  const group = project.whatsappGroup;
  if (
    !group
    || group.status !== ProjectWhatsAppGroupStatus.ACTIVE
    || !group.inviteLink
  ) {
    throw new DomainTransitionError(
      "This project's WhatsApp group isn't ready yet, so there is no link to send.",
    );
  }
  return {
    inviteLink: group.inviteLink,
    project,
    recipients: ownerEmailRecipients(projectOwnerRows(project)),
  };
}

function firstNames(names: readonly string[]): string {
  const first = names
    .map((name) => name.trim().split(/\s+/)[0])
    .filter(Boolean);
  if (first.length === 0) return "there";
  if (first.length === 1) return first[0];
  return `${first.slice(0, -1).join(", ")} and ${first.at(-1)}`;
}

/** The starting wording for the invite, which the office then edits. */
export async function draftProjectWhatsAppInvite(
  principal: DomainPrincipal,
  input: { readonly projectId: string },
  db: DomainDb,
): Promise<ProjectWhatsAppInviteDraft> {
  requireStaffUser(principal);
  const { inviteLink, project, recipients } = await loadInviteContext(
    principal,
    input.projectId,
    db,
  );
  const site = project.location.trim() || project.name.trim();
  return {
    body: [
      `Hi ${firstNames(recipients.map((recipient) => recipient.name))},`,
      `We've set up a WhatsApp group for your build${site ? ` at ${site}` : ""} so you can reach the Royal Constructions team in one place — site updates, photos and questions all in the one chat.`,
      `Tap the link below on your phone to join:\n${inviteLink}`,
      "If it doesn't open, check WhatsApp is installed and try the link again, or just reply to this email.",
    ].join("\n\n"),
    inviteLink,
    recipients,
    subject: `Join your build's WhatsApp group${site ? ` — ${site}` : ""}`,
  };
}

export type ProjectInviteMailPort = (message: {
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
}) => Promise<unknown>;

export type SendProjectWhatsAppInviteResult = {
  readonly alreadySent: boolean;
  readonly recipients: readonly string[];
  readonly emailIds: readonly string[];
};

/**
 * Email the invite to the chosen owners and record it on the project's email
 * trail (the lead's emails, which the Communications tab shows).
 */
export async function sendProjectWhatsAppInvite(
  principal: DomainPrincipal,
  input: {
    readonly projectId: string;
    readonly recipients: readonly string[];
    readonly subject: string;
    readonly body: string;
    readonly senderName: string;
    readonly idempotencyKey: string;
  },
  db: DomainDb,
  ports: {
    readonly sendMail: ProjectInviteMailPort;
    readonly fromAddress: string;
  },
): Promise<SendProjectWhatsAppInviteResult> {
  requireStaffUser(principal);
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new DomainValidationError(
      "A send needs an idempotency key so a retry cannot email the owners twice.",
      "idempotencyKey",
    );
  }
  const { inviteLink, project, recipients } = await loadInviteContext(
    principal,
    input.projectId,
    db,
  );

  const allowed = new Map(
    recipients.map((recipient) => [recipient.email.toLowerCase(), recipient]),
  );
  const chosen = [
    ...new Set(input.recipients.map((email) => email.trim().toLowerCase())),
  ].filter(Boolean);
  if (chosen.length === 0) {
    throw new DomainValidationError(
      recipients.length === 0
        ? "No owner on this contract has an email address. Add one on the Overview tab first."
        : "Choose at least one owner to email.",
      "recipients",
    );
  }
  const stranger = chosen.find((email) => !allowed.has(email));
  if (stranger) {
    throw new DomainValidationError(
      "The invite only goes to the owners on the contract.",
      "recipients",
    );
  }
  const to = chosen.map((email) => allowed.get(email)?.email ?? email);

  const subject = input.subject.trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  const senderName = input.senderName.trim() || "Royal Constructions";
  if (!subject) throw new DomainValidationError("Add a subject.", "subject");
  if (subject.length > MAX_INVITE_SUBJECT_LENGTH) {
    throw new DomainValidationError(
      `Keep the subject under ${MAX_INVITE_SUBJECT_LENGTH} characters.`,
      "subject",
    );
  }
  if (!body) throw new DomainValidationError("Write a message.", "body");
  if (body.length > MAX_INVITE_BODY_LENGTH) {
    throw new DomainValidationError("The message is too long.", "body");
  }
  if (!body.includes(inviteLink)) {
    throw new DomainValidationError(
      "Keep the group's invite link in the message — without it the owners can't join.",
      "body",
    );
  }

  const html = projectWhatsAppInviteHtml({ body, inviteLink, senderName });

  // The effect is the send and nothing else. Writing the trail inside it would
  // let a database hiccup after Graph accepted the mail fail the intent — and
  // report "nothing went out" for an email the owners already have.
  let outcome: { replayed: boolean; result: { sentAt: string } };
  try {
    outcome = await runOutboxEffectWithOutcome(
      db,
      {
        key: `project-whatsapp-invite:${project.id}:${idempotencyKey}`,
        kind: OutboxEventKind.PROJECT_WHATSAPP_INVITE_SEND,
        payload: { projectId: project.id, recipients: to, subject },
      },
      async () => {
        await ports.sendMail({ body: html, subject, to });
        return { sentAt: new Date().toISOString() };
      },
    );
  } catch (error) {
    if (error instanceof DomainTransitionError) throw error;
    // A failed Graph call is not proof the mail stayed put: a timeout can
    // follow a send that went through.
    throw new DomainSideEffectError(
      "The invite email may not have been sent. Check Sent Items in the mailbox before sending it again.",
      "email",
      false,
      { cause: error },
    );
  }

  const emailIds = outcome.replayed
    ? []
    : await recordInviteTrail(db, {
        from: ports.fromAddress,
        html,
        leadId: project.leadId,
        sentAt: new Date(outcome.result.sentAt),
        subject,
        to,
      });

  return {
    alreadySent: outcome.replayed,
    emailIds,
    recipients: to,
  };
}

/**
 * Put a sent invite on the lead's email trail, one row per owner.
 *
 * The mail has already gone, so a failure here is logged and the send still
 * reported as sent: the owners have the email whether or not the trail does.
 */
async function recordInviteTrail(
  db: DomainDb,
  input: {
    readonly from: string;
    readonly html: string;
    readonly leadId: number;
    readonly sentAt: Date;
    readonly subject: string;
    readonly to: readonly string[];
  },
): Promise<string[]> {
  const from = input.from.trim().toLowerCase();
  const emailIds: string[] = [];
  try {
    for (const recipient of input.to) {
      const email = await db.leadEmails.create({
        data: {
          body: input.html,
          checksum: createHash("sha256")
            .update(
              JSON.stringify({
                body: input.html,
                from,
                subject: input.subject,
                to: recipient,
              }),
            )
            .digest("hex"),
          emailFrom: from,
          emailTo: recipient.toLowerCase(),
          leadId: input.leadId,
          sentAt: input.sentAt,
          subject: input.subject,
        },
        select: { id: true },
      });
      emailIds.push(email.id);
    }
  } catch (error) {
    console.error(
      `[whatsapp-invite] The invite was sent but ${input.to.length - emailIds.length} trail row(s) could not be written.`,
      error,
    );
  }
  return emailIds;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** The email as the owners receive it: their words, the link made a link. */
export function projectWhatsAppInviteHtml(input: {
  readonly body: string;
  readonly inviteLink: string;
  readonly senderName: string;
}): string {
  const link = escapeHtml(input.inviteLink);
  const anchor = `<a href="${link}" style="color:${RC_COLORS.gold};font-weight:600;">${link}</a>`;
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;line-height:1.55;">${paragraph
          .split("\n")
          .map((line) => escapeHtml(line).split(link).join(anchor))
          .join("<br>")}</p>`,
    )
    .join("");
  const button = `<p style="margin:20px 0 22px;"><a href="${link}" style="display:inline-block;background:${RC_COLORS.gold};color:${RC_COLORS.white};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;font-family:${FONTS.body};">Join the WhatsApp group</a></p>`;
  return `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div style="background-color:${RC_COLORS.container};margin:0;padding:0">${EMAIL_HEADER_HTML}<div style="padding:8px 24px;font-family:${FONTS.body};font-size:15px;color:${RC_COLORS.text};">${paragraphs}${button}<p style="margin:16px 0 0;">Thanks &amp; Regards,<br>${escapeHtml(input.senderName)}<br>Royal Constructions.</p></div>${EMAIL_FOOTER_HTML}</div></body></html>`;
}
