import { idempotencyHeader } from "@/lib/idempotency/attempt-key";
import { fetchJson } from "@/utils/fetch";

import type {
  BrowserCredentialDto,
  CallDto,
  CommsStatusDto,
  LeadCallsDto,
  PlaceCallResultDto,
  SmsMessageDto,
  SmsSendResultDto,
  SmsThreadDto,
  WhatsAppCallDto,
  WhatsAppCallPermissionDto,
} from "./comms-types";

// The browser's side of the SMS, call and WhatsApp-call routes. Each call
// unwraps the { success, data } envelope and lets a FetchError carry the
// server's sentence — "this lead replied STOP", not "request failed".

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
const GET: RequestInit = { cache: "no-store", method: "GET" };

// ── SMS ───────────────────────────────────────────────────────────────

export function fetchSmsThread(
  leadId: number,
  signal?: AbortSignal,
): Promise<SmsThreadDto> {
  return unwrap(
    `/api/leads/${leadId}/sms`,
    { ...GET, signal },
    "Could not load the SMS conversation.",
  );
}

/** `idempotencyKey` is the attempt's key: the same for a retry, new after a success. */
export function sendSms(
  leadId: number,
  body: string,
  idempotencyKey: string,
): Promise<SmsSendResultDto> {
  return unwrap(
    `/api/leads/${leadId}/sms`,
    {
      body: JSON.stringify({ body }),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The text could not be sent.",
  );
}

export function markSmsRead(leadId: number): Promise<unknown> {
  return unwrap(
    `/api/leads/${leadId}/sms/read`,
    { method: "POST" },
    "Could not mark the texts read.",
  );
}

export function reconcileSms(
  leadId: number,
  messageId: string,
  outcome: "sent" | "not_sent",
): Promise<{ message: SmsMessageDto }> {
  return unwrap(
    `/api/leads/${leadId}/sms/${encodeURIComponent(messageId)}/reconcile`,
    {
      body: JSON.stringify({ outcome }),
      headers: JSON_HEADERS,
      method: "POST",
    },
    "Could not settle the text.",
  );
}

// ── Calls ─────────────────────────────────────────────────────────────

export function fetchLeadCalls(
  leadId: number,
  signal?: AbortSignal,
): Promise<LeadCallsDto> {
  return unwrap(
    `/api/leads/${leadId}/calls`,
    { ...GET, signal },
    "Could not load the calls.",
  );
}

export function placeLeadCall(
  leadId: number,
  target: "browser" | "mobile",
  idempotencyKey: string,
): Promise<PlaceCallResultDto> {
  return unwrap(
    `/api/leads/${leadId}/calls`,
    {
      body: JSON.stringify({ target }),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The call could not be placed.",
  );
}

export function fetchCall(
  callId: string,
  signal?: AbortSignal,
): Promise<CallDto> {
  return unwrap(
    `/api/calls/${encodeURIComponent(callId)}`,
    { ...GET, signal },
    "Could not load the call.",
  );
}

export function hangupCall(callId: string): Promise<CallDto> {
  return unwrap(
    `/api/calls/${encodeURIComponent(callId)}/hangup`,
    { method: "POST" },
    "The call could not be ended.",
  );
}

export function retryRecording(recordingId: string): Promise<unknown> {
  return unwrap(
    `/api/calls/recordings/${encodeURIComponent(recordingId)}/retry`,
    { method: "POST" },
    "Could not retry the recording.",
  );
}

export function recordingUrl(recordingId: string): string {
  return `/api/calls/recordings/${encodeURIComponent(recordingId)}`;
}

export function fetchBrowserCredential(): Promise<BrowserCredentialDto> {
  return unwrap(
    "/api/comms/voice/token",
    GET,
    "The browser phone couldn't connect.",
  );
}

export function fetchCommsStatus(
  signal?: AbortSignal,
): Promise<CommsStatusDto> {
  return unwrap(
    "/api/comms/status",
    { ...GET, signal },
    "Could not load the phone settings.",
  );
}

export function fetchUnmatchedComms(
  signal?: AbortSignal,
): Promise<{ sms: SmsMessageDto[]; calls: CallDto[] }> {
  return unwrap(
    "/api/comms/unmatched",
    { ...GET, signal },
    "Could not load unmatched texts and calls.",
  );
}

export function fileUnmatchedSms(
  messageId: string,
  body: { action: "attach"; leadId: number } | { action: "dismiss" },
): Promise<unknown> {
  return unwrap(
    `/api/comms/unmatched/sms/${encodeURIComponent(messageId)}`,
    { body: JSON.stringify(body), headers: JSON_HEADERS, method: "POST" },
    "Could not file the text.",
  );
}

// ── WhatsApp calls ────────────────────────────────────────────────────

export function fetchRingingWhatsAppCalls(
  signal?: AbortSignal,
): Promise<{ calls: WhatsAppCallDto[]; enabled: boolean }> {
  return unwrap(
    "/api/whatsapp-calls",
    { ...GET, signal },
    "Could not check for WhatsApp calls.",
  );
}

export function fetchWhatsAppCall(
  callId: string,
  signal?: AbortSignal,
): Promise<WhatsAppCallDto> {
  return unwrap(
    `/api/whatsapp-calls/${encodeURIComponent(callId)}`,
    { ...GET, signal },
    "Could not load the call.",
  );
}

export function answerWhatsAppCall(
  callId: string,
  sdpAnswer: string,
): Promise<WhatsAppCallDto> {
  return unwrap(
    `/api/whatsapp-calls/${encodeURIComponent(callId)}/answer`,
    {
      body: JSON.stringify({ sdpAnswer }),
      headers: JSON_HEADERS,
      method: "POST",
    },
    "The call couldn't be answered.",
  );
}

export function rejectWhatsAppCall(callId: string): Promise<WhatsAppCallDto> {
  return unwrap(
    `/api/whatsapp-calls/${encodeURIComponent(callId)}/reject`,
    { method: "POST" },
    "The call couldn't be declined.",
  );
}

export function hangupWhatsAppCall(callId: string): Promise<WhatsAppCallDto> {
  return unwrap(
    `/api/whatsapp-calls/${encodeURIComponent(callId)}/hangup`,
    { method: "POST" },
    "The call couldn't be ended.",
  );
}

export function fetchIceServers(): Promise<{ iceServers: RTCIceServer[] }> {
  return unwrap(
    "/api/whatsapp-calls/ice",
    GET,
    "Could not reach the call relay.",
  );
}

export function fetchWhatsAppCallPermission(
  leadId: number,
  signal?: AbortSignal,
): Promise<WhatsAppCallPermissionDto> {
  return unwrap(
    `/api/leads/${leadId}/whatsapp/call-permission`,
    { ...GET, signal },
    "Could not check WhatsApp calling.",
  );
}

export function requestWhatsAppCallPermission(
  leadId: number,
  idempotencyKey: string,
): Promise<{ alreadySent: boolean; permission: WhatsAppCallPermissionDto }> {
  return unwrap(
    `/api/leads/${leadId}/whatsapp/call-permission`,
    { headers: idempotencyHeader(idempotencyKey), method: "POST" },
    "The request couldn't be sent.",
  );
}

export function startWhatsAppCall(
  leadId: number,
  sdpOffer: string,
  idempotencyKey: string,
): Promise<{ call: WhatsAppCallDto; alreadyPlaced: boolean }> {
  return unwrap(
    `/api/leads/${leadId}/whatsapp/calls`,
    {
      body: JSON.stringify({ sdpOffer }),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The WhatsApp call couldn't be placed.",
  );
}
