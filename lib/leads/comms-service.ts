import { idempotencyHeader } from "@/lib/idempotency/attempt-key";
import { fetchJson } from "@/utils/fetch";

import type {
  BrowserCredentialDto,
  CallDto,
  CommsAvailabilityDto,
  CommsStatusDto,
  LeadCallsDto,
  LeadCommsUnreadDto,
  PendingCommsDto,
  PlaceCallResultDto,
  ProjectCallsDto,
  SmsMessageDto,
  SmsSendResultDto,
  SmsThreadDto,
  OwnerCallDetailDto,
  OwnerCallDto,
  OwnerLineDto,
  TeamPhoneDto,
  UnmatchedCommsDto,
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

/** `phoneId`: the team phone to ring for `mobile`; null is the office mobile. */
export function placeLeadCall(
  leadId: number,
  target: "browser" | "mobile",
  idempotencyKey: string,
  phoneId: string | null = null,
): Promise<PlaceCallResultDto> {
  return unwrap(
    `/api/leads/${leadId}/calls`,
    {
      body: JSON.stringify({ phoneId, target }),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The call could not be placed.",
  );
}

// ── Project calls (ADMIN) ─────────────────────────────────────────────

export function fetchProjectCalls(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectCallsDto> {
  return unwrap(
    `/api/projects/${encodeURIComponent(projectId)}/calls`,
    { ...GET, signal },
    "Could not load the project's calls.",
  );
}

/** `to`: one of the project's people by `ref`, or a typed number. */
export function placeProjectCall(
  projectId: string,
  to: { contactRef: string } | { number: string },
  target: "browser" | "mobile",
  idempotencyKey: string,
  phoneId: string | null = null,
): Promise<PlaceCallResultDto> {
  return unwrap(
    `/api/projects/${encodeURIComponent(projectId)}/calls`,
    {
      body: JSON.stringify({ phoneId, target, to }),
      headers: { ...JSON_HEADERS, ...idempotencyHeader(idempotencyKey) },
      method: "POST",
    },
    "The call could not be placed.",
  );
}

export function fetchProjectCallsUnread(
  projectId: string,
  signal?: AbortSignal,
): Promise<{ unread: number }> {
  return unwrap(
    `/api/projects/${encodeURIComponent(projectId)}/calls/unread`,
    { ...GET, signal },
    "Could not count the project's new calls.",
  );
}

export function markProjectCallsRead(
  projectId: string,
): Promise<{ marked: number }> {
  return unwrap(
    `/api/projects/${encodeURIComponent(projectId)}/calls/unread`,
    { method: "POST" },
    "Could not mark the calls read.",
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

// ── Team phones ───────────────────────────────────────────────────────

export function fetchTeamPhones(): Promise<{ phones: TeamPhoneDto[] }> {
  return unwrap(
    "/api/comms/team-phones",
    GET,
    "Could not load the team phones.",
  );
}

export function addTeamPhone(input: {
  nickname: string;
  number: string;
}): Promise<{ phone: TeamPhoneDto }> {
  return unwrap(
    "/api/comms/team-phones",
    { body: JSON.stringify(input), headers: JSON_HEADERS, method: "POST" },
    "Could not add the phone.",
  );
}

export function updateTeamPhone(
  phoneId: string,
  input: { nickname?: string; number?: string },
): Promise<{ phone: TeamPhoneDto }> {
  return unwrap(
    `/api/comms/team-phones/${encodeURIComponent(phoneId)}`,
    { body: JSON.stringify(input), headers: JSON_HEADERS, method: "PATCH" },
    "Could not update the phone.",
  );
}

export function removeTeamPhone(phoneId: string): Promise<unknown> {
  return unwrap(
    `/api/comms/team-phones/${encodeURIComponent(phoneId)}`,
    { method: "DELETE" },
    "Could not remove the phone.",
  );
}

export function fetchOwnerLine(): Promise<{ ownerLine: OwnerLineDto | null }> {
  return unwrap("/api/comms/owner-line", GET, "Could not load the owner line.");
}

export function saveOwnerLine(input: {
  nickname: string;
  number: string;
}): Promise<{ ownerLine: OwnerLineDto }> {
  return unwrap(
    "/api/comms/owner-line",
    { body: JSON.stringify(input), headers: JSON_HEADERS, method: "PUT" },
    "Could not save the owner line.",
  );
}

export function clearOwnerLine(): Promise<unknown> {
  return unwrap(
    "/api/comms/owner-line",
    { method: "DELETE" },
    "Could not clear the owner line.",
  );
}

export function fetchAgentCalls(): Promise<{
  pending: OwnerCallDto[];
  recent: OwnerCallDto[];
}> {
  return unwrap(
    "/api/comms/agent-calls",
    GET,
    "Could not load the agent calls.",
  );
}

export function fetchAgentCall(
  ownerCallId: string,
): Promise<OwnerCallDetailDto> {
  return unwrap(
    `/api/comms/agent-calls/${encodeURIComponent(ownerCallId)}`,
    GET,
    "Could not load the agent call.",
  );
}

export function cancelAgentCall(ownerCallId: string): Promise<OwnerCallDto> {
  return unwrap(
    `/api/comms/agent-calls/${encodeURIComponent(ownerCallId)}/cancel`,
    { method: "POST" },
    "Could not cancel the call.",
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

/** Whether calling and texting are available; readable by any staff. */
export function fetchCommsAvailability(
  signal?: AbortSignal,
): Promise<CommsAvailabilityDto> {
  return unwrap(
    "/api/comms/status",
    { ...GET, signal },
    "Could not load whether calling is available.",
  );
}

export function fetchUnmatchedComms(
  signal?: AbortSignal,
): Promise<UnmatchedCommsDto> {
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

// ── Unread and pending ────────────────────────────────────────────────

/** Unread calls and texts per lead, for a page of the lead list. */
export function fetchLeadCommsUnread(
  leadIds: number[],
  signal?: AbortSignal,
): Promise<LeadCommsUnreadDto[]> {
  if (leadIds.length === 0) return Promise.resolve([]);
  return unwrap(
    `/api/leads/comms/unread?leadIds=${leadIds.join(",")}`,
    { ...GET, signal },
    "Could not load unread calls and texts.",
  );
}

/** Mark a lead's unread calls and texts read: its Phone & SMS window opened. */
export function markLeadCommsRead(
  leadId: number,
): Promise<{ marked: { calls: number; sms: number } }> {
  return unwrap(
    `/api/leads/${leadId}/comms/read`,
    { method: "POST" },
    "Could not mark the calls and texts read.",
  );
}

export function fetchPendingComms(
  signal?: AbortSignal,
): Promise<PendingCommsDto> {
  return unwrap(
    "/api/comms/pending",
    { ...GET, signal },
    "Could not load pending calls and messages.",
  );
}

export function fetchPendingCommsCount(
  signal?: AbortSignal,
): Promise<{ unread: number }> {
  return unwrap(
    "/api/comms/pending/count",
    { ...GET, signal },
    "Could not count pending calls and messages.",
  );
}

/** Mark exactly the pending items a person was shown as read. */
export function markPendingCommsRead(body: {
  callIds: string[];
  smsIds: string[];
}): Promise<unknown> {
  return unwrap(
    "/api/comms/pending/read",
    { body: JSON.stringify(body), headers: JSON_HEADERS, method: "POST" },
    "Could not mark the calls and messages read.",
  );
}

export function filePendingCall(
  callId: string,
  body: { action: "attach"; leadId: number } | { action: "dismiss" },
): Promise<{ call: CallDto }> {
  return unwrap(
    `/api/comms/pending/calls/${encodeURIComponent(callId)}`,
    { body: JSON.stringify(body), headers: JSON_HEADERS, method: "POST" },
    "Could not file the call.",
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
