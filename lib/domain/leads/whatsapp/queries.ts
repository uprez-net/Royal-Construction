import type { WhatsAppConsentSource } from "@prisma/client";

import { canAccessLead, leadListScope } from "../../access/leads";
import type { DomainDb } from "../../db";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "../../errors";
import type {
  WhatsAppBusinessNumber,
  WhatsAppChannel,
} from "../../ports/whatsapp";
import type { DomainPrincipal } from "../../principal";
import { normaliseLeadPhone } from "./phone";
import {
  evaluateWhatsAppEligibility,
  isWindowOpen,
  type WhatsAppEligibility,
} from "./policy";
import {
  toWhatsAppMessageRecord,
  WHATSAPP_MESSAGE_SELECT,
  type LeadWhatsAppMessageRecord,
} from "./records";
import {
  availableWhatsAppTemplates,
  prefillWhatsAppTemplateParameters,
  renderWhatsAppTemplate,
  type WhatsAppTemplateDefinition,
} from "./templates";

// Reads for the WhatsApp thread and the lead-list summary (issue #333).
//
// The modal and Eve's `get_lead_whatsapp` read the thread through the same
// function; the lead list reads only the summary, so a page of fifty leads
// never loads fifty conversations.

export const MAX_THREAD_PAGE = 50;
export const MAX_SUMMARY_LEADS = 200;

export type WhatsAppTemplateOption = {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly language: string;
  readonly parameters: WhatsAppTemplateDefinition["parameters"];
  /** Suggested values for this lead. */
  readonly defaults: readonly string[];
  /** The body with the suggested values substituted. */
  readonly preview: string;
};

export type LeadWhatsAppThread = {
  readonly lead: {
    readonly id: number;
    readonly name: string;
    readonly phone: string;
    readonly isArchived: boolean;
    readonly consentNote: string | null;
    readonly optedOutAt: Date | null;
  };
  readonly eligibility: WhatsAppEligibility;
  /** Oldest first, for rendering top to bottom. */
  readonly messages: readonly LeadWhatsAppMessageRecord[];
  /** Pass as `before` to load the page of older messages. */
  readonly olderCursor: string | null;
  readonly unreadCount: number;
  readonly senders: readonly WhatsAppBusinessNumber[];
  readonly templates: readonly WhatsAppTemplateOption[];
};

export async function getLeadWhatsAppThread(
  principal: DomainPrincipal,
  input: {
    readonly leadId: number;
    /** A message id; returns the page of messages older than it. */
    readonly before?: string | null;
    readonly limit?: number;
    readonly now?: Date;
  },
  db: DomainDb,
  context: { readonly channel: WhatsAppChannel | null },
): Promise<LeadWhatsAppThread> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 30, MAX_THREAD_PAGE));

  const lead = await db.lead.findUnique({
    select: {
      assignedId: true,
      id: true,
      isArchived: true,
      location: true,
      name: true,
      phone: true,
      type: true,
      whatsappConsentAt: true,
      whatsappConsentNote: true,
      whatsappConsentSource: true,
      whatsappOptedOutAt: true,
    },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (!canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }

  let cursor: { occurredAt: Date; id: string } | null = null;
  if (input.before) {
    cursor = await db.leadWhatsAppMessage.findFirst({
      select: { id: true, occurredAt: true },
      where: { id: input.before, leadId: lead.id },
    });
    if (!cursor) {
      throw new DomainValidationError(
        "That page of the conversation is no longer available. Reload it.",
        "before",
      );
    }
  }

  const [conversations, rows] = await Promise.all([
    db.leadWhatsAppConversation.findMany({
      select: {
        businessPhoneNumberId: true,
        customerPhoneE164: true,
        lastInboundAt: true,
        unreadCount: true,
        windowExpiresAt: true,
      },
      where: { leadId: lead.id },
    }),
    db.leadWhatsAppMessage.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: WHATSAPP_MESSAGE_SELECT,
      // One extra, to know whether an older page exists.
      take: limit + 1,
      where: {
        leadId: lead.id,
        ...(cursor
          ? {
              OR: [
                { occurredAt: { lt: cursor.occurredAt } },
                { id: { lt: cursor.id }, occurredAt: cursor.occurredAt },
              ],
            }
          : {}),
      },
    }),
  ]);

  const page = rows.slice(0, limit);
  const olderCursor = rows.length > limit ? (page.at(-1)?.id ?? null) : null;
  const templates = availableWhatsAppTemplates(context.channel).map(
    (template) => {
      const defaults = prefillWhatsAppTemplateParameters(template, lead);
      return {
        defaults,
        description: template.description,
        label: template.label,
        language: template.language,
        name: template.name,
        parameters: template.parameters,
        preview: renderWhatsAppTemplate(template, defaults),
      };
    },
  );

  return {
    eligibility: evaluateWhatsAppEligibility({
      channel: context.channel,
      conversations,
      lead,
      now,
    }),
    lead: {
      consentNote: lead.whatsappConsentNote,
      id: lead.id,
      isArchived: lead.isArchived,
      name: lead.name,
      optedOutAt: lead.whatsappOptedOutAt,
      phone: lead.phone,
    },
    messages: page.reverse().map(toWhatsAppMessageRecord),
    olderCursor,
    senders: context.channel?.numbers ?? [],
    templates,
    unreadCount: conversations.reduce(
      (total, conversation) => total + conversation.unreadCount,
      0,
    ),
  };
}

export type LeadWhatsAppSummary = {
  readonly leadId: number;
  readonly phoneE164: string | null;
  /** Why the WhatsApp action is unavailable; null when it is available. */
  readonly unavailableReason: string | null;
  readonly lastMessageAt: Date | null;
  readonly lastDirection: "INBOUND" | "OUTBOUND" | null;
  readonly unreadCount: number;
  readonly windowOpen: boolean;
  readonly windowExpiresAt: Date | null;
  readonly consentRecorded: boolean;
  readonly consentSource: WhatsAppConsentSource | null;
  readonly optedOut: boolean;
};

/**
 * The small per-row summary the lead list shows. Scoped with
 * `leadListScope`, so a caller is never told about a lead they cannot list.
 */
export async function listLeadWhatsAppSummaries(
  principal: DomainPrincipal,
  input: { readonly leadIds: readonly number[]; readonly now?: Date },
  db: DomainDb,
): Promise<LeadWhatsAppSummary[]> {
  const now = input.now ?? new Date();
  if (input.leadIds.length > MAX_SUMMARY_LEADS) {
    throw new DomainValidationError(
      `Ask for at most ${MAX_SUMMARY_LEADS} leads at a time.`,
      "leadIds",
    );
  }
  if (input.leadIds.length === 0) return [];
  const scope = leadListScope(principal);

  const leads = await db.lead.findMany({
    select: {
      id: true,
      isArchived: true,
      phone: true,
      whatsappConsentAt: true,
      whatsappConsentSource: true,
      whatsappConversations: {
        select: {
          lastInboundAt: true,
          lastMessageAt: true,
          lastOutboundAt: true,
          unreadCount: true,
          windowExpiresAt: true,
        },
      },
      whatsappOptedOutAt: true,
    },
    where: {
      id: { in: [...input.leadIds] },
      ...(scope.assignedId ? { assignedId: scope.assignedId } : {}),
    },
  });

  return leads.map((lead) => {
    const phone = normaliseLeadPhone(lead.phone);
    const conversations = lead.whatsappConversations;
    const latest = conversations.reduce<(typeof conversations)[number] | null>(
      (best, conversation) =>
        (conversation.lastMessageAt?.getTime() ?? 0)
        > (best?.lastMessageAt?.getTime() ?? 0)
          ? conversation
          : best,
      null,
    );
    const openWindows = conversations.filter((conversation) =>
      isWindowOpen(conversation, now),
    );
    const windowExpiresAt = openWindows.reduce<Date | null>(
      (latestExpiry, conversation) =>
        conversation.windowExpiresAt
        && (!latestExpiry || conversation.windowExpiresAt > latestExpiry)
          ? conversation.windowExpiresAt
          : latestExpiry,
      null,
    );
    const lastDirection = !latest?.lastMessageAt
      ? null
      : latest.lastInboundAt
          && latest.lastInboundAt.getTime() === latest.lastMessageAt.getTime()
        ? "INBOUND"
        : "OUTBOUND";

    return {
      consentRecorded: lead.whatsappConsentAt !== null,
      consentSource: lead.whatsappConsentSource,
      lastDirection,
      lastMessageAt: latest?.lastMessageAt ?? null,
      leadId: lead.id,
      optedOut: lead.whatsappOptedOutAt !== null,
      phoneE164: phone.e164,
      unavailableReason: lead.isArchived
        ? "This lead is archived, so it can no longer be actioned."
        : phone.usable
          ? null
          : phone.reason,
      unreadCount: conversations.reduce(
        (total, conversation) => total + conversation.unreadCount,
        0,
      ),
      windowExpiresAt,
      windowOpen: openWindows.length > 0,
    } satisfies LeadWhatsAppSummary;
  });
}

/** Clear the unread count once someone has opened the thread. */
export async function markLeadWhatsAppRead(
  principal: DomainPrincipal,
  input: { readonly leadId: number },
  db: DomainDb,
): Promise<void> {
  const lead = await db.lead.findUnique({
    select: { assignedId: true, id: true },
    where: { id: input.leadId },
  });
  if (!lead) throw new DomainNotFoundError("Lead not found");
  if (principal.kind !== "user" || !canAccessLead(principal, lead)) {
    throw new DomainAuthorizationError("You do not have access to this lead");
  }
  await db.leadWhatsAppConversation.updateMany({
    data: { unreadCount: 0 },
    where: { leadId: lead.id, unreadCount: { gt: 0 } },
  });
}
