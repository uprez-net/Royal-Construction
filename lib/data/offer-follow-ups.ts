import "server-only";

import { sendEmail } from "@/lib/azureClient";
import {
  listOfferFollowUpAlerts,
  sendOfferFollowUp,
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
 * anything was written, so no cache tag would ever expire it. An empty list on
 * failure, logged, because the alerts are one panel above the offers table and
 * must not take the table down with them.
 */
export async function getOfferFollowUpAlerts(
  principal: DomainPrincipal,
): Promise<OfferFollowUpAlert[]> {
  try {
    return await listOfferFollowUpAlerts(principal, prisma);
  } catch (error) {
    console.error("Error reading offer follow-up alerts:", error);
    return [];
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
