import "server-only";

import { sendEmail } from "@/lib/azureClient";
import {
  listOfferFollowUpAlerts,
  markOfferFollowUpDone,
  sendOfferFollowUp,
  type MarkOfferFollowUpDoneResult,
  type OfferFollowUpAlert,
  type SendOfferFollowUpResult,
} from "@/lib/domain/offers/follow-ups";
import type { DomainPrincipal } from "@/lib/domain/principal";
import { renderClientEmailHtml } from "@/lib/leads/lead-email-send";
import prisma from "@/lib/prisma";

// The Next adapter over `lib/domain/offers/follow-ups.ts` (issue #449). The
// rule — who is due, who may be written to, once per attempt — is the domain's;
// what is left here is the mail provider and the rendering.

/**
 * The Offers page's follow-up alerts, read fresh on every render.
 *
 * Uncached on purpose: an offer becomes due because a day passed, not because
 * anything was written, so no cache tag would ever expire it.
 *
 * A failed read says so in `failed` rather than answering an empty list, which
 * would read as "no follow-ups due" — the client nobody chased is the cost.
 * It still does not throw: the alerts are one panel above the offers table and
 * must not take the table down with them.
 */
export type OfferFollowUpAlertsResult = {
  alerts: OfferFollowUpAlert[];
  failed: boolean;
};

export async function getOfferFollowUpAlerts(
  principal: DomainPrincipal,
): Promise<OfferFollowUpAlertsResult> {
  try {
    return {
      alerts: await listOfferFollowUpAlerts(principal, prisma),
      failed: false,
    };
  } catch (error) {
    console.error("Error reading offer follow-up alerts:", error);
    return { alerts: [], failed: true };
  }
}

/** Render the administrator's text as the client's email and send it once. */
export async function sendOfferFollowUpEmail(
  principal: DomainPrincipal,
  input: {
    offerId: string;
    to: string;
    subject: string;
    body: string;
    attemptKey: string;
  },
): Promise<SendOfferFollowUpResult> {
  return sendOfferFollowUp(
    principal,
    { ...input, html: renderClientEmailHtml(input.body) },
    prisma,
    { sendMail: sendEmail },
  );
}

/** The office chased the client another way; take the alert off the list. */
export async function markOfferFollowUpDoneForOffice(
  principal: DomainPrincipal,
  offerId: string,
): Promise<MarkOfferFollowUpDoneResult> {
  return markOfferFollowUpDone(principal, { offerId }, prisma);
}
