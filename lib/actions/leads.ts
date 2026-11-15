"use server";

import type { LeadEmails } from "@prisma/client";
import { requireInternalUser } from "@/lib/auth/require-internal-user";
import { authorizeLeadAccess } from "@/lib/data/offer-access";
import * as leads from "@/lib/data/leads";
import type {
  FollowupStats,
  LeadsOverview,
  SafeForecast,
} from "@/lib/data/leads";
import type { FyQuarter } from "@/lib/leads/fy-quarter";
import type { Lead as UiLead } from "@/lib/leads/types";
import { bookConsultationHref } from "@/lib/leads/lead-actions";
import { signBookConsultationToken } from "@/lib/leads/book-consultation-token";

// The lead screens call these from the browser. lib/data/leads.ts is
// server-only and checks nobody, since its other callers (the lead routes, MCP,
// the booking route and workflow steps) authorize in their own way, so each
// action here checks its caller before it reads or sends anything.
//
// A refusal throws, where these return a value, to keep the signatures the
// screens already rely on: staff never reach one from the UI, so there is no
// user-facing message for Next to hide.

async function assertStaff(): Promise<void> {
  const access = await requireInternalUser();
  if (!access.ok) {
    throw new Error(access.error);
  }
}

/** Every lead: the leads table, its export and the campaign recipient list. */
export async function getAllLeads(): Promise<UiLead[]> {
  await assertStaff();
  return leads.getAllLeads();
}

/** One lead, or null when it does not exist or the caller may not open it. */
export async function findLeadById(id: number): Promise<UiLead | null> {
  if (!Number.isSafeInteger(id)) {
    return null;
  }
  const access = await authorizeLeadAccess(id);
  if (!access.ok) {
    return null;
  }
  return leads.findLeadById(id);
}

export async function getFollowupStats(): Promise<FollowupStats> {
  await assertStaff();
  return leads.getFollowupStats();
}

/** The lead cards and analytics, in one action: see `getLeadsOverview`. */
export async function getLeadsOverview(
  filterTiming?: string,
): Promise<LeadsOverview> {
  await assertStaff();
  return leads.getLeadsOverview(filterTiming);
}

export async function getForecast(
  fy: number,
  quarter: FyQuarter,
): Promise<SafeForecast> {
  await assertStaff();
  return leads.getForecast(fy, quarter);
}

/** Staff-only booking URL with a signed lead token for the public booking route. */
export async function bookConsultationUrlForLead(
  lead: Pick<UiLead, "id" | "name" | "email">,
  teammateName?: string | null,
): Promise<string> {
  const access = await authorizeLeadAccess(lead.id);
  if (!access.ok) {
    throw new Error(access.error);
  }
  const token = signBookConsultationToken(lead.id);
  if (!token) {
    throw new Error(
      "Booking links are not configured (set BOOK_CONSULTATION_TOKEN_SECRET).",
    );
  }
  return bookConsultationHref(
    { ...lead, email: lead.email ?? "" } as UiLead,
    teammateName,
    token,
  );
}

export async function sendLeadEmail(
  leadId: number,
  location: string,
  body: string,
  to: string,
  replyingToEmail?: LeadEmails,
): Promise<LeadEmails> {
  const access = await authorizeLeadAccess(leadId);
  if (!access.ok) {
    throw new Error(access.error);
  }
  return leads.sendLeadEmail(leadId, location, body, to, replyingToEmail);
}
