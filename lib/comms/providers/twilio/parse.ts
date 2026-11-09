import type {
  CallState,
  CommsEvent,
  DialOutcome,
} from "@/lib/domain/ports/comms";
import { carrierNumberToE164 } from "@/lib/domain/comms/shared";

import type { ParsedWebhook, WebhookRequest } from "../../types";

// Twilio's form-encoded callbacks → neutral CommsEvents (file 06 §6.2).
//
// Twilio's call statuses already match the persisted vocabulary. Message
// statuses fold into QUEUED/SENT/DELIVERED/FAILED. Fields this does not use
// are ignored; a callback missing a field it does use is dropped with a
// reason rather than guessed at.

export const TWILIO_WEBHOOK_EVENTS = new Set([
  "sms-inbound",
  "sms-status",
  "voice-inbound",
  "voice-status",
  "voice-connect",
  "voice-gather",
  "voice-dial",
  "voice-leg",
  "voice-recording",
  "voice-voicemail-done",
  "voice-agent-stream",
  "voice-agent-done",
]);

const CALL_STATES: ReadonlySet<string> = new Set<CallState>([
  "queued",
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);

const SID = /^[A-Za-z0-9]{2,64}$/;

function smsStatus(
  raw: string,
): "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | null {
  switch (raw) {
    case "accepted":
    case "scheduled":
    case "queued":
    case "sending":
      return "QUEUED";
    case "sent":
      return "SENT";
    case "delivered":
    case "read":
      return "DELIVERED";
    case "undelivered":
    case "failed":
    case "canceled":
      return "FAILED";
    default:
      return null;
  }
}

function dialOutcome(raw: string): DialOutcome {
  switch (raw) {
    case "completed":
    case "answered":
      return "answered";
    case "busy":
      return "busy";
    case "no-answer":
      return "no-answer";
    case "canceled":
      return "canceled";
    default:
      return "failed";
  }
}

function seconds(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** A customer number, or a stable placeholder for a withheld caller. */
function caller(raw: string | null): string {
  return carrierNumberToE164(raw) ?? "withheld";
}

export function parseTwilioWebhook(
  request: WebhookRequest,
): ParsedWebhook | null {
  const form = new URLSearchParams(request.rawBody);
  const get = (name: string) => form.get(name)?.trim() || null;
  const callId = request.query.get("callId");
  const callSid = get("CallSid");
  const ack = (
    events: CommsEvent[],
    dedupeKey: string | null = null,
  ): ParsedWebhook => ({
    dedupeKey,
    events,
    respondWith: "ack",
  });
  const markup = (events: CommsEvent[]): ParsedWebhook => ({
    dedupeKey: null,
    events,
    respondWith: "markup",
  });

  switch (request.event) {
    case "sms-inbound": {
      const sid = get("MessageSid") ?? get("SmsSid");
      const from = carrierNumberToE164(get("From"));
      const to = carrierNumberToE164(get("To"));
      if (!sid || !SID.test(sid) || !from || !to) return null;
      return markup([
        {
          body: form.get("Body") ?? "",
          from,
          mediaCount: seconds(get("NumMedia")) ?? 0,
          providerMessageId: sid,
          receivedAt: request.now,
          to,
          type: "sms.received",
        },
      ]);
    }
    case "sms-status": {
      const sid = get("MessageSid") ?? get("SmsSid");
      const status = smsStatus(get("MessageStatus") ?? get("SmsStatus") ?? "");
      if (!sid || !SID.test(sid)) return null;
      if (!status)
        return { ...ack([]), ignoredReason: "unknown message status" };
      return ack(
        [
          {
            errorCode: get("ErrorCode"),
            occurredAt: request.now,
            providerMessageId: sid,
            status,
            type: "sms.status",
          },
        ],
        `sms:${sid}:${status}`,
      );
    }
    case "voice-inbound": {
      if (!callSid || !SID.test(callSid)) return null;
      return markup([
        {
          from: caller(get("From")),
          providerCallId: callSid,
          to: carrierNumberToE164(get("To")) ?? get("To") ?? "",
          type: "call.incoming",
        },
      ]);
    }
    case "voice-connect": {
      if (!callSid) return null;
      return markup([
        { callId, providerCallId: callSid, type: "call.answered" },
      ]);
    }
    case "voice-gather": {
      if (!callSid) return null;
      return markup([
        {
          callId,
          digits: get("Digits") ?? "",
          providerCallId: callSid,
          type: "call.gathered",
        },
      ]);
    }
    case "voice-dial": {
      if (!callSid) return null;
      return markup([
        {
          callId,
          durationSeconds: seconds(get("DialCallDuration")),
          outcome: dialOutcome(get("DialCallStatus") ?? ""),
          providerCallId: callSid,
          type: "call.dialed",
        },
      ]);
    }
    case "voice-voicemail-done": {
      if (!callSid) return null;
      return {
        ...markup([]),
        pending: {
          callId,
          instructions: [{ op: "hangup" }],
          providerCallId: callSid,
        },
      };
    }
    case "voice-status": {
      const state = get("CallStatus");
      if (!callSid || !state) return null;
      if (!CALL_STATES.has(state))
        return { ...ack([]), ignoredReason: "unknown call status" };
      return ack(
        [
          {
            callId,
            durationSeconds: seconds(get("CallDuration")),
            hangupCause: state === "completed" ? null : state,
            occurredAt: request.now,
            providerCallId: callSid,
            state: state as CallState,
            type: "call.status",
          },
        ],
        `cs:${callSid}:${state}:${get("SequenceNumber") ?? ""}`,
      );
    }
    case "voice-leg": {
      // The staff leg answered. Its CallSid is the child leg's; the parent
      // (the customer) is ParentCallSid, and Royal's id is in the URL.
      if (get("CallStatus") !== "in-progress") return ack([]);
      return ack(
        [
          {
            callId,
            providerCallId: get("ParentCallSid"),
            type: "call.connected",
          },
        ],
        callSid ? `leg:${callSid}:answered` : null,
      );
    }
    case "voice-recording": {
      const recordingSid = get("RecordingSid");
      if (!recordingSid || !SID.test(recordingSid)) return null;
      if (get("RecordingStatus") !== "completed") return ack([]);
      return ack(
        [
          {
            callId,
            durationSeconds: seconds(get("RecordingDuration")),
            providerCallId: callSid ?? "",
            providerRecordingId: recordingSid,
            type: "call.recording",
            // The conversation with Mili, started by the adapter; it may be
            // saved after the call moved on to voicemail.
            ...(request.query.get("kind") === "call"
              ? { kind: "call" as const }
              : {}),
          },
        ],
        `rec:${recordingSid}`,
      );
    }
    case "voice-agent-stream": {
      // Mili's Media Stream changed state. Once audio flows, record the
      // conversation (the caller has heard the declaration).
      if (!callSid) return null;
      const streamSid = get("StreamSid");
      if (get("StreamEvent") !== "stream-started") return ack([]);
      return {
        ...ack([], streamSid ? `stream:${streamSid}:started` : null),
        recordAfterConnect:
          request.query.get("record") === "1"
            ? { callId, providerCallId: callSid }
            : null,
      };
    }
    case "voice-agent-done": {
      // <Connect> ended without the voice agent moving the call on: Mili never
      // got going, or her session dropped. The caller still needs somebody.
      if (!callSid) return null;
      return markup([
        {
          callId,
          outcome: "failed",
          providerCallId: callSid,
          transcript: null,
          type: "call.agentEnded",
        },
      ]);
    }
    default:
      return null;
  }
}
