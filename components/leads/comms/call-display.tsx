import {
  Bot,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Voicemail,
} from "lucide-react";

import type { CallDto } from "@/lib/leads/comms-types";

// How one call reads in a list: its status word, its length, its icon. Shared
// by a lead's Calls tab and a project's Calls, so the two logs say the same
// thing about the same call.

export const CALL_STATUS_LABEL: Record<CallDto["status"], string> = {
  BUSY: "Busy",
  CANCELED: "Cancelled",
  COMPLETED: "Completed",
  FAILED: "Failed",
  INITIATED: "Dialling",
  IN_PROGRESS: "In progress",
  NO_ANSWER: "No answer",
  QUEUED: "Queued",
  RINGING: "Ringing",
};

/** A call that may still change: poll faster while one is on the list. */
export const LIVE_CALL_STATUSES = new Set<CallDto["status"]>([
  "QUEUED",
  "INITIATED",
  "RINGING",
  "IN_PROGRESS",
]);

export function callDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CallIcon({ call }: { call: CallDto }) {
  if (call.answeredBy === "VOICEMAIL")
    return <Voicemail className="size-4 text-warning-ink" aria-hidden="true" />;
  if (call.answeredBy === "AGENT")
    return <Bot className="size-4 text-success-ink" aria-hidden="true" />;
  if (call.direction === "INBOUND") {
    return call.connectedAt ? (
      <PhoneIncoming className="size-4 text-success-ink" aria-hidden="true" />
    ) : (
      <PhoneMissed className="size-4 text-destructive" aria-hidden="true" />
    );
  }
  return <PhoneOutgoing className="size-4 text-primary" aria-hidden="true" />;
}

/** "· told it was recorded", or nothing. */
export function recordingNote(call: CallDto): string | null {
  switch (call.recordingConsent) {
    case "GRANTED":
      return " · recording allowed";
    case "DECLARED":
      return " · told it was recorded";
    case "DECLINED":
      return " · not recorded";
    default:
      return null;
  }
}
