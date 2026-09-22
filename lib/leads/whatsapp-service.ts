import { fetchJson } from "@/utils/fetch";
import { idempotencyHeader } from "@/lib/idempotency/attempt-key";

import type {
  WhatsAppConsentDto,
  WhatsAppMessageDto,
  WhatsAppSendBody,
  WhatsAppSendResultDto,
  WhatsAppSummaryDto,
  WhatsAppThreadDto,
  WhatsAppUnmatchedListDto,
} from "./whatsapp-types";

// The browser's side of the lead WhatsApp routes (issue #333). Each call
// unwraps the { success, data } envelope and lets a FetchError carry the
// server's sentence — the operator needs "the customer hasn't messaged in the
// last 24 hours", not "request failed".

async function unwrap<T>(
  input: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  const body = await fetchJson<T>(input, init, fallback);
  if (!body.success) throw new Error(fallback);
  return body.data;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function fetchWhatsAppThread(
  leadId: number,
  options: { before?: string | null; limit?: number; signal?: AbortSignal } = {},
): Promise<WhatsAppThreadDto> {
  const params = new URLSearchParams();
  if (options.before) params.set("before", options.before);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return unwrap<WhatsAppThreadDto>(
    `/api/leads/${leadId}/whatsapp${query}`,
    { cache: "no-store", method: "GET", signal: options.signal },
    "Could not load the WhatsApp conversation.",
  );
}

/**
 * Send one message.
 *
 * `idempotencyKey` is the attempt's key from `useIdempotencyKey()`: the same
 * key for a double click or a retry, a new one only after a send succeeded.
 * The route refuses a request without one.
 */
export function sendWhatsAppMessage(
  leadId: number,
  body: WhatsAppSendBody,
  idempotencyKey: string,
): Promise<WhatsAppSendResultDto> {
  return unwrap<WhatsAppSendResultDto>(
    `/api/leads/${leadId}/whatsapp/messages`,
    {
      body: JSON.stringify(body),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The WhatsApp message could not be sent.",
  );
}

export function markWhatsAppRead(leadId: number): Promise<unknown> {
  return unwrap(
    `/api/leads/${leadId}/whatsapp/read`,
    { method: "POST" },
    "Could not mark the conversation as read.",
  );
}

export function recordWhatsAppConsent(
  leadId: number,
  body:
    | { action: "grant"; source: string; note?: string | null }
    | { action: "opt_out"; note?: string | null },
): Promise<WhatsAppConsentDto> {
  return unwrap<WhatsAppConsentDto>(
    `/api/leads/${leadId}/whatsapp/consent`,
    { body: JSON.stringify(body), headers: JSON_HEADERS, method: "POST" },
    "Could not record WhatsApp consent.",
  );
}

export function reconcileWhatsAppMessage(
  leadId: number,
  messageId: string,
  outcome: "sent" | "not_sent",
): Promise<WhatsAppMessageDto> {
  return unwrap<WhatsAppMessageDto>(
    `/api/leads/${leadId}/whatsapp/messages/${encodeURIComponent(messageId)}/reconcile`,
    { body: JSON.stringify({ outcome }), headers: JSON_HEADERS, method: "POST" },
    "Could not reconcile the message.",
  );
}

/** Summaries for the leads on screen; no request at all for an empty page. */
export function fetchWhatsAppSummaries(
  leadIds: number[],
  signal?: AbortSignal,
): Promise<WhatsAppSummaryDto[]> {
  if (leadIds.length === 0) return Promise.resolve([]);
  return unwrap<WhatsAppSummaryDto[]>(
    `/api/leads/whatsapp/summary?leadIds=${leadIds.join(",")}`,
    { cache: "no-store", method: "GET", signal },
    "Could not load WhatsApp summaries.",
  );
}

export function fetchUnmatchedWhatsApp(
  signal?: AbortSignal,
): Promise<WhatsAppUnmatchedListDto> {
  return unwrap<WhatsAppUnmatchedListDto>(
    "/api/leads/whatsapp/unmatched",
    { cache: "no-store", method: "GET", signal },
    "Could not load unmatched WhatsApp messages.",
  );
}

export function reviewUnmatchedWhatsApp(
  unmatchedId: string,
  body: { action: "attach"; leadId: number } | { action: "dismiss" },
): Promise<unknown> {
  return unwrap(
    `/api/leads/whatsapp/unmatched/${encodeURIComponent(unmatchedId)}`,
    { body: JSON.stringify(body), headers: JSON_HEADERS, method: "POST" },
    "Could not update the message.",
  );
}
