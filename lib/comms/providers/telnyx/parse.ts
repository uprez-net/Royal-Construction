import { z } from "zod";

import type { CallState, CommsEvent, DialOutcome } from "@/lib/domain/ports/comms";
import { carrierNumberToE164 } from "@/lib/domain/comms/shared";

import type { ParsedWebhook, WebhookRequest } from "../../types";
import { decodeClientState, type TelnyxClientState } from "./client-state";

// Telnyx's JSON webhooks → neutral CommsEvents (file 07 §4–5, file 06 §6.2).
//
// Every field name here is from the docs read on 3 November 2026 and is
// marked VERIFY there: capture a real delivery per event type from a test
// account and store it under tests/comms/fixtures before trusting this in
// production. The parser is strict about the fields it uses and lenient about
// the rest, so an unexpected event is acknowledged and ignored, not guessed at.

export const TELNYX_WEBHOOK_EVENTS = new Set(["sms", "voice"]);

const envelope = z.object({
  data: z
    .object({
      event_type: z.string().min(1),
      id: z.string().min(1),
      occurred_at: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).default({}),
    })
    .passthrough(),
});

type Payload = Record<string, unknown>;

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function party(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "phone_number" in value) {
    const phone = (value as { phone_number?: unknown }).phone_number;
    return typeof phone === "string" ? phone : null;
  }
  return null;
}

function at(raw: string | null | undefined, fallback: Date): Date {
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
}

function secondsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

/** VERIFY against real events: Telnyx's hangup causes, mapped per file 06 §6.2. */
export function stateFromHangupCause(cause: string | null): CallState {
  switch (cause) {
    case "normal_clearing":
      return "completed";
    case "user_busy":
    case "call_rejected":
      return "busy";
    case "no_answer":
    case "timeout":
      return "no-answer";
    case "originator_cancel":
      return "canceled";
    default:
      return "failed";
  }
}

function dialOutcomeFromCause(cause: string | null): DialOutcome {
  const state = stateFromHangupCause(cause);
  return state === "completed" ? "answered" : (state as DialOutcome);
}

/** Telnyx's per-recipient message status → Royal's SMS status. */
export function telnyxSmsStatus(raw: string | null): "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | null {
  switch (raw) {
    case "queued":
    case "sending":
      return "QUEUED";
    case "sent":
    // Not proven delivered: never show "delivered" for it (file 07 §4).
    case "delivery_unconfirmed":
      return "SENT";
    case "delivered":
      return "DELIVERED";
    case "delivery_failed":
    case "sending_failed":
      return "FAILED";
    default:
      return null;
  }
}

export function parseTelnyxWebhook(request: WebhookRequest): ParsedWebhook | null {
  let json: unknown;
  try {
    json = JSON.parse(request.rawBody);
  } catch {
    return null;
  }
  const parsed = envelope.safeParse(json);
  if (!parsed.success) return null;
  const { event_type: type, id: eventId, payload } = parsed.data.data;
  const occurredAt = at(parsed.data.data.occurred_at, request.now);
  const ack = (events: CommsEvent[], extra: Partial<ParsedWebhook> = {}): ParsedWebhook => ({
    dedupeKey: eventId,
    events,
    respondWith: "ack",
    ...extra,
  });
  const ignore = (reason: string) => ack([], { ignoredReason: reason });

  if (request.event === "sms") {
    const messageId = str(payload, "id");
    if (!messageId) return null;
    const firstTo = Array.isArray(payload.to) ? payload.to[0] : payload.to;
    if (type === "message.received") {
      const from = carrierNumberToE164(party(payload.from));
      const to = carrierNumberToE164(party(firstTo));
      if (!from || !to) return ignore("message without a usable number");
      return ack([
        {
          body: typeof payload.text === "string" ? payload.text : "",
          from,
          mediaCount: Array.isArray(payload.media) ? payload.media.length : 0,
          providerMessageId: messageId,
          receivedAt: at(str(payload, "received_at"), occurredAt),
          to,
          type: "sms.received",
        },
      ]);
    }
    if (type === "message.sent" || type === "message.finalized") {
      const recipient = (firstTo ?? {}) as Payload;
      const status =
        telnyxSmsStatus(typeof recipient.status === "string" ? recipient.status : null)
        ?? (type === "message.sent" ? "SENT" : null);
      if (!status) return ignore("unknown message status");
      const errors = Array.isArray(payload.errors) ? (payload.errors as Payload[]) : [];
      const code = errors[0]?.code;
      return ack([
        {
          errorCode: typeof code === "string" || typeof code === "number" ? String(code) : null,
          occurredAt,
          providerMessageId: messageId,
          status,
          type: "sms.status",
        },
      ]);
    }
    return ignore(`messaging event ${type}`);
  }

  // ── Call Control ──────────────────────────────────────────────────────
  const callControlId = str(payload, "call_control_id");
  if (!callControlId) return null;
  const state: TelnyxClientState | null = decodeClientState(payload.client_state);
  const callId = state?.c ?? null;
  const staffLeg = state?.r === "b";
  const continuation = (pendingState: TelnyxClientState | null) =>
    pendingState?.n?.length
      ? { callId: pendingState.c ?? null, instructions: pendingState.n, providerCallId: callControlId }
      : null;

  switch (type) {
    case "call.initiated": {
      if (staffLeg) return ignore("staff leg initiated");
      if (str(payload, "direction") === "incoming" && !state) {
        return ack([
          {
            from: carrierNumberToE164(str(payload, "from")) ?? "withheld",
            providerCallId: callControlId,
            to: carrierNumberToE164(str(payload, "to")) ?? str(payload, "to") ?? "",
            type: "call.incoming",
          },
        ]);
      }
      return ack([
        {
          callId,
          durationSeconds: null,
          hangupCause: null,
          occurredAt,
          providerCallId: callControlId,
          state: "initiated",
          type: "call.status",
        },
      ]);
    }
    case "call.answered": {
      if (staffLeg) {
        return ack([{ callId, providerCallId: state?.a ?? null, type: "call.connected" }], {
          recordAfterConnect:
            state?.rec === 1 && state.a ? { callId, providerCallId: state.a } : null,
        });
      }
      return ack([{ callId, providerCallId: callControlId, type: "call.answered" }]);
    }
    case "call.hangup": {
      const cause = str(payload, "hangup_cause");
      const duration = secondsBetween(str(payload, "start_time"), str(payload, "end_time"));
      if (staffLeg) {
        if (!state?.a) return ignore("staff leg without its customer leg");
        return ack([
          {
            callId,
            durationSeconds: duration,
            outcome: dialOutcomeFromCause(cause),
            providerCallId: state.a,
            type: "call.dialed",
          },
        ]);
      }
      return ack([
        {
          callId,
          durationSeconds: duration,
          hangupCause: cause,
          occurredAt,
          providerCallId: callControlId,
          state: stateFromHangupCause(cause),
          type: "call.status",
        },
      ]);
    }
    case "call.gather.ended":
      return ack([
        {
          callId,
          digits: str(payload, "digits") ?? "",
          providerCallId: callControlId,
          type: "call.gathered",
        },
      ]);
    case "call.speak.ended":
      return ack([], { pending: continuation(state) });
    case "call.recording.saved": {
      const recordingId = str(payload, "recording_id");
      if (!recordingId) return ignore("recording without an id");
      return ack(
        [
          {
            callId,
            durationSeconds: secondsBetween(
              str(payload, "recording_started_at"),
              str(payload, "recording_ended_at"),
            ),
            providerCallId: callControlId,
            providerRecordingId: recordingId,
            type: "call.recording",
          },
        ],
        { pending: continuation(state) },
      );
    }
    default:
      return ignore(`call event ${type}`);
  }
}
