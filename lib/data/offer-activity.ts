"use server";

import { authorizeLeadAccess } from "@/lib/data/offer-access";
// A "use server" module may only export async server actions, so the const + types
// live in a plain module (ADR 0004).
import type { OfferActivity } from "@/lib/data/offer-activity-types";
import {
  loadOfferActivity as loadOfferActivityDomain,
  logOfferChangeRequest as logOfferChangeRequestDomain,
} from "@/lib/domain/offers/activity";
import { userPrincipal } from "@/lib/domain/principal";
import prisma from "@/lib/prisma";

// The negotiation activity for a lead's active offer: each Offer-document send with
// its open/reply telemetry (OfferDocumentSend) and each lifecycle event
// (OfferStatusEvent — signing transitions, plus logged change requests). Read-only;
// surfaced on the Send & negotiate step so the email back-and-forth (which happens
// off-system, in the builder's mailbox) is at least visible in-app (ADR 0004).
export async function loadOfferActivity(input: {
  leadId: number;
}): Promise<OfferActivity> {
  const access = await authorizeLeadAccess(input.leadId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  return loadOfferActivityDomain(
    userPrincipal(access.user),
    input.leadId,
    prisma,
  );
}

// Log a customer change request captured off the email thread, so the negotiation
// substance is recorded in-app (ADR 0004). Stored as an OfferStatusEvent note with
// fromStatus == toStatus (the current status) — an audit note, not a transition.
export async function logOfferChangeRequest(input: {
  leadId: number;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await authorizeLeadAccess(input.leadId);
  if (!access.ok) {
    return { ok: false, error: access.error };
  }
  return logOfferChangeRequestDomain(userPrincipal(access.user), input, prisma);
}
