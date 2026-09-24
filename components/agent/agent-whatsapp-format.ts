/**
 * Reading WhatsApp payloads out of tool results and approval arguments
 * (issue #333).
 *
 * Plain functions, no React, so the parsing is testable in Node. Everything
 * here is model-influenced — a tool result passes through the model's
 * transcript, and inbound message text is a customer's words — so it is read
 * defensively, field by field, and rendered as text only. Nothing that fails a
 * check reaches the DOM.
 */

import {
  findWhatsAppTemplate,
  renderWhatsAppTemplate,
} from "@/lib/domain/leads/whatsapp/templates";

export type WhatsAppStatusTone = "neutral" | "good" | "warn" | "bad";

export type AgentWhatsAppMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  status: string;
  statusLabel: string;
  tone: WhatsAppStatusTone;
  occurredAt: string | null;
  templateName: string | null;
  authorName: string | null;
  businessDisplayNumber: string | null;
  providerError: string | null;
  needsReconciliation: boolean;
  untrusted: boolean;
};

export type AgentWhatsAppThread = {
  leadName: string | null;
  destination: string | null;
  sender: { label: string; displayNumber: string } | null;
  windowOpen: boolean;
  windowExpiresAt: string | null;
  consentRecorded: boolean;
  optedOut: boolean;
  archived: boolean;
  sendingAvailable: boolean;
  textAllowed: boolean;
  textReason: string | null;
  templateAllowed: boolean;
  templateReason: string | null;
  unreadCount: number;
  olderMessagesAvailable: boolean;
  messages: AgentWhatsAppMessage[];
};

export type AgentWhatsAppDraft = {
  leadId: number | null;
  mode: "text" | "template";
  body: string | null;
  templateName: string | null;
  parameters: string[];
  destination: string | null;
  sender: { label: string; displayNumber: string } | null;
  requestedSenderId: string | null;
  allowed: boolean | null;
  reason: string | null;
  windowOpen: boolean | null;
  /** True when this is an approval card built from the send arguments. */
  fromApproval: boolean;
};

const MAX_MESSAGES = 50;
const MAX_TEXT = 4_096;

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Obj)
    : null;
}

function str(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function bool(value: unknown): boolean {
  return value === true;
}

function sender(value: unknown): AgentWhatsAppDraft["sender"] {
  const candidate = obj(value);
  const label = str(candidate?.label, 100);
  const displayNumber = str(candidate?.displayNumber, 40);
  return label && displayNumber ? { displayNumber, label } : null;
}

const STATUS: Record<string, { label: string; tone: WhatsAppStatusTone }> = {
  DELIVERED: { label: "Delivered", tone: "good" },
  FAILED: { label: "Failed", tone: "bad" },
  QUEUED: { label: "Queued", tone: "neutral" },
  READ: { label: "Read", tone: "good" },
  RECEIVED: { label: "Received", tone: "neutral" },
  SENT: { label: "Sent", tone: "neutral" },
};

export function whatsappStatusLabel(
  status: string,
  needsReconciliation = false,
): { label: string; tone: WhatsAppStatusTone } {
  if (needsReconciliation) return { label: "Needs checking", tone: "warn" };
  return STATUS[status] ?? { label: "Unknown", tone: "neutral" };
}

export function readWhatsAppMessage(
  value: unknown,
): AgentWhatsAppMessage | null {
  const message = obj(value);
  if (!message) return null;
  const id = str(message.id, 100);
  const body = str(message.body, MAX_TEXT);
  const direction =
    message.direction === "INBOUND" || message.direction === "OUTBOUND"
      ? message.direction
      : null;
  const status = str(message.status, 20);
  if (!id || !body || !direction || !status) return null;
  const needsReconciliation = bool(message.needsReconciliation);
  const { label, tone } = whatsappStatusLabel(status, needsReconciliation);
  return {
    authorName: str(message.authorName, 100),
    body,
    businessDisplayNumber: str(message.businessDisplayNumber, 40),
    direction,
    id,
    needsReconciliation,
    occurredAt: str(message.occurredAt, 40),
    providerError: str(message.providerError, 300),
    status,
    statusLabel: label,
    templateName: str(message.templateName, 100),
    tone,
    // Inbound is always the customer's text, whatever the payload claims.
    untrusted: direction === "INBOUND" || bool(message.untrusted),
  };
}

export function readWhatsAppThread(value: unknown): AgentWhatsAppThread | null {
  const thread = obj(value);
  if (!thread) return null;
  const lead = obj(thread.lead);
  const window = obj(thread.window);
  const consent = obj(thread.consent);
  const text = obj(thread.text);
  const template = obj(thread.template);
  if (!window || !text || !template) return null;
  const messages = Array.isArray(thread.messages)
    ? thread.messages
        .slice(-MAX_MESSAGES)
        .map(readWhatsAppMessage)
        .filter((message): message is AgentWhatsAppMessage => message !== null)
    : [];
  return {
    archived: bool(lead?.archived),
    consentRecorded: bool(consent?.recorded),
    destination: str(thread.destination, 40),
    leadName: str(lead?.name, 200),
    messages,
    olderMessagesAvailable: bool(thread.olderMessagesAvailable),
    optedOut: bool(lead?.optedOut),
    sender: sender(thread.sender),
    sendingAvailable: bool(thread.sendingAvailable),
    templateAllowed: bool(template.allowed),
    templateReason: str(template.reason),
    textAllowed: bool(text.allowed),
    textReason: str(text.reason),
    unreadCount:
      typeof thread.unreadCount === "number"
      && Number.isFinite(thread.unreadCount)
        ? Math.max(0, Math.floor(thread.unreadCount))
        : 0,
    windowExpiresAt: str(window.expiresAt, 40),
    windowOpen: bool(window.open),
  };
}

export function readWhatsAppDraft(value: unknown): AgentWhatsAppDraft | null {
  const draft = obj(value);
  if (!draft) return null;
  const mode =
    draft.mode === "text" || draft.mode === "template" ? draft.mode : null;
  if (!mode) return null;
  return {
    allowed: typeof draft.allowed === "boolean" ? draft.allowed : null,
    body: str(draft.body, MAX_TEXT),
    destination: str(draft.destination, 40),
    fromApproval: false,
    leadId:
      typeof draft.leadId === "number" && Number.isInteger(draft.leadId)
        ? draft.leadId
        : null,
    mode,
    parameters: Array.isArray(draft.parameters)
      ? draft.parameters
          .map((parameter) => str(parameter, 200))
          .filter((parameter): parameter is string => parameter !== null)
          .slice(0, 10)
      : [],
    reason: str(draft.reason),
    requestedSenderId: str(draft.requestedSenderId, 200),
    sender: sender(draft.sender),
    templateName: str(draft.templateName, 100),
    windowOpen: typeof draft.windowOpen === "boolean" ? draft.windowOpen : null,
  };
}

/** The tool whose approval shows a WhatsApp message instead of raw args. */
export const WHATSAPP_SEND_TOOL = "send_lead_whatsapp_message";

/**
 * The message an owner is being asked to approve.
 *
 * Built from the send tool's validated arguments. The destination is not in
 * them — the domain resolves the lead's own primary phone — so the card says
 * that rather than showing a number the model could have made up.
 */
export function approvalWhatsApp(
  toolName: string | null | undefined,
  input: unknown,
): AgentWhatsAppDraft | null {
  if (toolName !== WHATSAPP_SEND_TOOL) return null;
  const args = obj(input);
  if (!args) return null;
  const draft = readWhatsAppDraft({
    body: args.body,
    requestedSenderId: args.businessPhoneNumberId,
    leadId: args.leadId,
    mode: args.mode,
    parameters: args.templateParameters,
    templateName: args.templateName,
  });
  if (!draft) return null;
  if (draft.mode === "template") {
    // A template goes out as Meta's approved wording, never as `body`, so the
    // owner approves that wording. An unknown template or a wrong number of
    // values shows no body rather than a guess — the send refuses both.
    const template = draft.templateName
      ? findWhatsAppTemplate(draft.templateName)
      : null;
    const body =
      template && draft.parameters.length === template.parameters.length
        ? renderWhatsAppTemplate(template, draft.parameters)
        : null;
    return { ...draft, body, fromApproval: true };
  }
  return { ...draft, fromApproval: true };
}

/** Keys the WhatsApp approval preview already shows. */
export const WHATSAPP_APPROVAL_KEYS = new Set([
  "body",
  "businessPhoneNumberId",
  "leadId",
  "mode",
  "requestedSenderId",
  "templateName",
  "templateParameters",
]);

const sydney = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "Australia/Sydney",
});

/** "22 Sept, 3:04 pm" in Sydney time, or null for a missing/invalid time. */
export function sydneyDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : sydney.format(date);
}
