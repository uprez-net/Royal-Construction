import { OutboxEventKind } from "@prisma/client";

import type { DomainDb } from "../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../errors";
import { runOutboxEffectWithOutcome } from "../outbox";
import { canAccessLead } from "../access/leads";
import { isOfficePrincipal, type DomainPrincipal } from "../principal";

// Emailing a lead from the composer.
//
// Two rules that were not written down anywhere:
//
//   1. **Who the message may go to.** The composer sent `to` straight from the
//      browser. The Server Action checked the caller could open the LEAD, and
//      then sent whatever address came with the request — so an authorised
//      caller could use Royal's mailbox to send an arbitrary body to an
//      arbitrary address. That is the same shape as the tradie reminder that
//      took `{ to, subject, body }` and checked nobody, and it is fixed the
//      same way: the recipient has to be one of the addresses recorded on the
//      lead.
//
//   2. **Sending it once.** Nothing was idempotent. A double-click, or a retry
//      after a slow Graph call, sent the client the same message twice.
//
// Composing the body, rendering it, generating the subject and recording the
// thread stay with the adapter. What lives here is who may send, to whom, and
// how many times.

export type LeadEmailRecipients = {
  readonly email: string | null;
  readonly secondaryEmail: string | null;
};

/** The addresses a message about this lead is allowed to reach. */
export function allowedLeadRecipients(lead: LeadEmailRecipients): string[] {
  return [lead.email, lead.secondaryEmail]
    .map((address) => address?.trim().toLowerCase() ?? "")
    .filter((address) => address !== "");
}

export type AuthorizedLeadEmail = {
  readonly leadId: number;
  readonly to: string;
  /** For the greeting; read here so the adapter needs no second lookup. */
  readonly leadName: string;
};

/**
 * Check the caller may email this lead, and that the address belongs to it.
 *
 * Internal staff only. A CUSTOMER can open the lead assigned to them — that is
 * what `canAccessLead` says — but reading their own record is not a reason to
 * be able to send mail from the company mailbox.
 */
export async function authorizeLeadEmail(
  principal: DomainPrincipal,
  input: { leadId: number; to: string },
  db: DomainDb,
): Promise<AuthorizedLeadEmail> {
  if (!isOfficePrincipal(principal)) {
    throw new DomainAuthorizationError(
      "Sending mail about a lead requires internal staff access.",
    );
  }

  const lead = await db.lead.findUnique({
    select: {
      assignedId: true,
      email: true,
      id: true,
      name: true,
      secondaryEmail: true,
    },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }

  const requested = input.to.trim().toLowerCase();
  if (!requested) {
    throw new DomainValidationError("A recipient is required.", "to");
  }
  if (!allowedLeadRecipients(lead).includes(requested)) {
    // Deliberately not "we sent it anyway to the lead's own address": the
    // operator asked for a specific recipient, and silently redirecting a
    // message is worse than refusing to send it.
    throw new DomainAuthorizationError(
      "That address is not on this lead. Update the lead's contact details first.",
    );
  }

  return { leadId: lead.id, leadName: lead.name, to: requested };
}

export type LeadEmailSendResult<T> = {
  readonly result: T;
  /** True when this exact message already went out and was not sent again. */
  readonly alreadySent: boolean;
};

/**
 * Send one message to a lead, once.
 *
 * The key covers the lead, the recipient and the body, so pressing Send twice
 * on the same composed message is one email while a genuine follow-up — new
 * text — goes out. Scoped to the day as well, so the same short message
 * ("Any update?") can be sent again next week without being mistaken for a
 * duplicate of this one.
 */
export async function sendLeadEmailOnce<
  T extends Record<string, string | number | boolean | null>,
>(
  authorized: AuthorizedLeadEmail,
  input: { readonly bodyFingerprint: string; readonly now?: Date },
  db: DomainDb,
  send: () => Promise<T>,
): Promise<LeadEmailSendResult<T>> {
  const day = (input.now ?? new Date()).toISOString().slice(0, 10);
  const { replayed, result } = await runOutboxEffectWithOutcome(
    db,
    {
      key: `lead-email:${day}:${authorized.leadId}:${authorized.to}:${input.bodyFingerprint}`,
      kind: OutboxEventKind.LEAD_EMAIL_SEND,
      payload: {
        leadId: authorized.leadId,
        to: authorized.to,
      },
    },
    send,
  );
  return { alreadySent: replayed, result };
}
