import type { SessionContext } from "eve/context";
import type { ToolContext } from "eve/tools";

import { AgentAuthorizationError, requireCurrentAgentActor } from "@/agent/lib/actor";
import { runAuditedAgentOperation } from "@/agent/lib/audited-operation";
import { agentDb } from "@/agent/lib/db";
import type { LeadWhatsAppMessageInput } from "@/agent/lib/lead-whatsapp-contracts";
import {
  bounded,
  iso,
  serializeWhatsAppMessage,
  UNTRUSTED_WARNING,
  whatsappEnvelope as envelope,
  whatsappIdempotencyKey,
  whatsappSendEnvelope,
  type WhatsAppSendAttempt,
} from "@/agent/lib/lead-whatsapp-envelopes";
import {
  agentResultEnvelopeSchema,
  type JsonValue,
} from "@/agent/lib/result-contracts";
import { isDomainError } from "@/lib/domain/errors";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import {
  getLeadWhatsAppThread,
  type LeadWhatsAppThread,
} from "@/lib/domain/leads/whatsapp/queries";
import type { LeadWhatsAppMessageRecord } from "@/lib/domain/leads/whatsapp/records";
import { sendLeadWhatsAppMessage } from "@/lib/domain/leads/whatsapp/send";
import {
  findWhatsAppTemplate,
  renderWhatsAppTemplate,
  validateWhatsAppTemplateParameters,
} from "@/lib/domain/leads/whatsapp/templates";
import { userPrincipal } from "@/lib/domain/principal";
import { createWhatsAppPortFromEnv } from "@/lib/whatsapp/cloud-api";
import { whatsappChannelFromEnv } from "@/lib/whatsapp/config";

// Eve's WhatsApp surface for leads (issue #333).
//
// An adapter and nothing else. Every rule — who may message this lead, the
// destination (always the lead's own primary phone), the sender, consent, the
// customer-service window, the approved templates and "has this call already
// sent?" — belongs to lib/domain/leads/whatsapp, which the App's composer calls
// too. This file resolves the actor from the authenticated session, hands the
// domain a `UserPrincipal`, and shapes what comes back into an envelope.
//
// Three things it will not do:
//
//   - claim a send happened unless the domain returned the message. A replay
//     says "already sent, not sent again"; an unreachable provider says
//     nothing was sent and points at the App.
//   - record anything inbound. Customer replies, delivery statuses, consent and
//     reconciliation arrive through the verified webhook or a person in the
//     App. An agent reading "the customer said yes" in model text is not a
//     receipt.
//   - reveal whether a lead it may not see exists.

function serializeThread(
  thread: LeadWhatsAppThread,
  messages: readonly LeadWhatsAppMessageRecord[],
): Record<string, JsonValue> {
  const { eligibility } = thread;
  return {
    consent: {
      at: iso(eligibility.consent.at),
      recorded: eligibility.consent.recorded,
      source: eligibility.consent.source,
    },
    destination: eligibility.phone.e164
      ? formatE164ForDisplay(eligibility.phone.e164)
      : null,
    destinationUsable: eligibility.phone.usable,
    lead: {
      archived: thread.lead.isArchived,
      id: thread.lead.id,
      name: thread.lead.name,
      optedOut: eligibility.optedOut,
    },
    messages: messages.map(serializeWhatsAppMessage),
    olderMessagesAvailable: thread.olderCursor !== null,
    sender: eligibility.sender
      ? {
          displayNumber: eligibility.sender.displayNumber,
          label: eligibility.sender.label,
        }
      : null,
    sendingAvailable: eligibility.sendingAvailable,
    template: {
      allowed: eligibility.template.allowed,
      reason: eligibility.template.reason,
    },
    templates: thread.templates.map((template) => ({
      defaults: [...template.defaults],
      description: template.description,
      label: template.label,
      name: template.name,
      parameters: template.parameters.map((parameter) => parameter.label),
      preview: template.preview,
    })),
    text: {
      allowed: eligibility.text.allowed,
      reason: eligibility.text.reason,
    },
    unreadCount: thread.unreadCount,
    window: {
      expiresAt: iso(eligibility.window.expiresAt),
      open: eligibility.window.open,
    },
  };
}

/** The domain read, with "not yours" and "not there" made indistinguishable. */
async function readThread(
  ctx: SessionContext,
  leadId: number,
  limit: number,
): Promise<LeadWhatsAppThread> {
  const actor = await requireCurrentAgentActor(ctx);
  try {
    return await getLeadWhatsAppThread(
      userPrincipal(actor),
      { leadId, limit: Math.max(1, limit) },
      agentDb,
      { channel: whatsappChannelFromEnv() },
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    throw new AgentAuthorizationError();
  }
}

export async function getAuthorizedLeadWhatsApp(
  ctx: SessionContext,
  input: { leadId: number; limit: number },
) {
  const thread = await readThread(ctx, input.leadId, input.limit);
  const messages = input.limit === 0 ? [] : thread.messages;
  const { eligibility } = thread;
  const hasInbound = messages.some((message) => message.direction === "INBOUND");
  const last = thread.messages.at(-1);

  return envelope({
    kind: "timeline",
    lead: thread.lead,
    title: `WhatsApp · ${thread.lead.name}`,
    summary: [
      last
        ? `Last message ${last.direction === "INBOUND" ? "from the customer" : "from Royal"} at ${last.occurredAt.toISOString()}.`
        : "No WhatsApp messages yet.",
      eligibility.window.open
        ? "The 24-hour reply window is open."
        : "The 24-hour reply window is closed; only an approved template can be sent.",
      thread.unreadCount > 0 ? `${thread.unreadCount} unread.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    data: { whatsapp: serializeThread(thread, messages) },
    warnings: hasInbound ? [UNTRUSTED_WARNING] : [],
  });
}

/**
 * Exactly what a send would put on the customer's phone, without sending.
 *
 * The approval card shows the send tool's arguments; this is how the model
 * gets the rendered text, the destination and the sender in front of the
 * owner first. The send re-evaluates everything against fresh rows.
 */
export async function prepareAuthorizedLeadWhatsAppMessage(
  ctx: SessionContext,
  input: LeadWhatsAppMessageInput,
) {
  const thread = await readThread(ctx, input.leadId, 1);
  const { eligibility } = thread;
  const warnings: string[] = [];

  let body: string | null = null;
  let parameters: string[] = [];
  let problem: string | null = null;
  if (input.mode === "text") {
    body = input.body ?? null;
    if (!eligibility.text.allowed) problem = eligibility.text.reason;
  } else {
    const template = input.templateName
      ? findWhatsAppTemplate(input.templateName)
      : null;
    const approved = thread.templates.some(
      (candidate) => candidate.name === template?.name,
    );
    if (!template || !approved) {
      problem = "That template isn't approved for this WhatsApp account.";
    } else {
      try {
        parameters = validateWhatsAppTemplateParameters(
          template,
          input.templateParameters ?? [],
        );
        body = renderWhatsAppTemplate(template, parameters);
      } catch (error) {
        if (!isDomainError(error)) throw error;
        problem = error.message;
      }
    }
    if (!problem && !eligibility.template.allowed) {
      problem = eligibility.template.reason;
    }
  }

  const requestedSender = input.businessPhoneNumberId
    ? thread.senders.find(
        (sender) => sender.phoneNumberId === input.businessPhoneNumberId,
      )
    : null;
  if (input.businessPhoneNumberId && !requestedSender) {
    problem ??= "That WhatsApp sender number isn't configured for this deployment.";
  } else if (
    requestedSender
    && requestedSender.phoneNumberId !== eligibility.sender?.phoneNumberId
  ) {
    warnings.push(
      "The window and permissions shown are for the default sender. The send re-checks them for the number you chose.",
    );
  }
  const sender = requestedSender ?? eligibility.sender;
  warnings.push(
    "Review the destination, sender and exact text before approving. The send re-checks consent, the reply window and the template.",
  );

  return envelope({
    kind: problem ? "error" : "follow-up-status",
    lead: thread.lead,
    title: problem ? "WhatsApp message can't be sent" : "WhatsApp message ready",
    summary: problem
      ?? `Ready to send to ${eligibility.phone.e164 ? formatE164ForDisplay(eligibility.phone.e164) : "the lead"} from ${sender?.label ?? "the default number"}. Nothing has been sent.`,
    data: {
      whatsapp: serializeThread(thread, []),
      whatsappDraft: {
        allowed: problem === null,
        body: body ? bounded(body, 4_096) : null,
        destination: eligibility.phone.e164
          ? formatE164ForDisplay(eligibility.phone.e164)
          : null,
        leadId: thread.lead.id,
        mode: input.mode,
        parameters,
        reason: problem,
        sender: sender
          ? { displayNumber: sender.displayNumber, label: sender.label }
          : null,
        templateName: input.mode === "template" ? (input.templateName ?? null) : null,
        windowExpiresAt: iso(eligibility.window.expiresAt),
        windowOpen: eligibility.window.open,
      },
    },
    warnings,
  });
}

export async function sendAuthorizedLeadWhatsAppMessage(
  ctx: ToolContext,
  input: LeadWhatsAppMessageInput,
) {
  const actor = await requireCurrentAgentActor(ctx);
  // Resolves the lead through the same scoped read, so a forbidden lead fails
  // here with nothing written and nothing about it disclosed.
  const thread = await readThread(ctx, input.leadId, 1);
  const lead = { id: thread.lead.id, name: thread.lead.name };
  const port = createWhatsAppPortFromEnv();

  return runAuditedAgentOperation({
    action: "lead.whatsapp.send",
    ctx,
    inputSummary: {
      hasBody: Boolean(input.body),
      leadId: input.leadId,
      mode: input.mode,
      parameterCount: input.templateParameters?.length ?? 0,
      templateName: input.templateName ?? null,
    },
    outputSchema: agentResultEnvelopeSchema,
    ownerUserId: actor.id,
    targetId: String(input.leadId),
    targetType: "lead",
    // The provider call cannot run inside a database transaction; the domain
    // owns its own intent/outbox transactions around it.
    transactional: false,
    execute: async () => {
      let attempt: WhatsAppSendAttempt;
      try {
        const result = await sendLeadWhatsAppMessage(
          userPrincipal(actor),
          {
            businessPhoneNumberId: input.businessPhoneNumberId ?? null,
            idempotencyKey: whatsappIdempotencyKey(ctx),
            leadId: input.leadId,
            message:
              input.mode === "text"
                ? { body: input.body ?? "", kind: "text" }
                : {
                    kind: "template",
                    parameters: input.templateParameters ?? [],
                    templateName: input.templateName ?? "",
                  },
          },
          agentDb,
          { whatsapp: port },
        );
        attempt = { ok: true, result };
      } catch (error) {
        attempt = { error, ok: false, providerAvailable: port !== null };
      }
      const result = whatsappSendEnvelope(lead, attempt);
      // Access lost between the read above and the send: answer exactly as a
      // lead that never existed would.
      if (result === "forbidden") throw new AgentAuthorizationError();
      return result;
    },
  });
}
