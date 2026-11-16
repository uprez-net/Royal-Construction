// What the SMS, call and WhatsApp-call routes answer, as the browser sees it:
// the domain records with dates as ISO strings.

export type SmsStatusDto =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "RECEIVED";

export type SmsMessageDto = {
  id: string;
  leadId: number | null;
  direction: "OUTBOUND" | "INBOUND";
  provider: "twilio" | "telnyx";
  businessNumber: string;
  customerNumber: string;
  body: string;
  mediaCount: number;
  status: SmsStatusDto;
  statusAt: string;
  occurredAt: string;
  deliveredAt: string | null;
  failedAt: string | null;
  readAt: string | null;
  needsReconciliation: boolean;
  providerErrorCode: string | null;
  providerErrorTitle: string | null;
  authorName: string | null;
  unmatchedReason: "NO_MATCH" | "AMBIGUOUS" | "UNKNOWN_BUSINESS_NUMBER" | null;
  reviewStatus: "PENDING" | "ATTACHED" | "DISMISSED" | null;
  candidateLeadIds: number[];
};

export type SmsThreadDto = {
  leadId: number;
  messages: SmsMessageDto[];
  hasOlder: boolean;
  eligibility: {
    allowed: boolean;
    reason: string | null;
    optedOut: boolean;
    to: string | null;
    from: string | null;
    fromLabel: string | null;
  };
};

export type SmsSendResultDto = { message: SmsMessageDto; alreadySent: boolean };

export type CallStatusDto =
  | "QUEUED"
  | "INITIATED"
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "BUSY"
  | "NO_ANSWER"
  | "FAILED"
  | "CANCELED";

export type CallDto = {
  id: string;
  provider: "twilio" | "telnyx";
  direction: "OUTBOUND" | "INBOUND";
  leadId: number | null;
  leadName: string | null;
  candidateLeadIds: number[];
  businessNumber: string;
  customerNumber: string;
  status: CallStatusDto;
  flowStep: string;
  staffTarget: "BROWSER" | "MOBILE" | null;
  /** Outbound to a phone: the nickname of the phone it rang. */
  staffPhoneLabel: string | null;
  staffName: string | null;
  answeredBy: "BROWSER" | "MOBILE" | "VOICEMAIL" | "AGENT" | null;
  recordingConsent: "NOT_ASKED" | "GRANTED" | "DECLINED" | "DECLARED";
  startedAt: string;
  answeredAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  hangupCause: string | null;
  needsReconciliation: boolean;
  problem: string | null;
  recordings: {
    id: string;
    kind: "CALL" | "VOICEMAIL";
    status: "PENDING" | "STORED" | "FAILED";
    durationSeconds: number | null;
    available: boolean;
    failureReason: string | null;
    /** Speech-to-text of the recording, once transcribed. */
    transcript: string | null;
    transcriptStatus: "PENDING" | "DONE" | "EMPTY" | "SKIPPED" | "FAILED";
  }[];
  /** What the caller and Mili said, one "Speaker: text" line per turn. */
  agentTranscript: string | null;
  seenAt: string | null;
  /** Mili or the voicemail took it and nobody has opened it yet. */
  unread: boolean;
};

/** "Pending Calls/Messages": what came in from numbers no lead owns. */
export type PendingCommsDto = {
  calls: CallDto[];
  sms: SmsMessageDto[];
  unread: number;
};

/** Unread calls and texts for one lead, for the badge over the call icon. */
export type LeadCommsUnreadDto = { leadId: number; calls: number; sms: number };

export type LeadCallsDto = {
  calls: CallDto[];
  options: {
    allowed: boolean;
    reason: string | null;
    to: string | null;
    browser: boolean;
    mobile: boolean;
    /** What "Call via phone" can ring. `id` is null for the office mobile. */
    phones: CallablePhoneDto[];
  };
};

export type CallablePhoneDto = {
  id: string | null;
  nickname: string;
  e164: string;
};

/** A team member's phone, as an admin manages it. */
export type TeamPhoneDto = { id: string; nickname: string; e164: string };

export type PlaceCallResultDto = { call: CallDto; alreadyPlaced: boolean };

export type BrowserCredentialDto =
  | {
      available: true;
      provider: "twilio" | "telnyx";
      identity: string;
      token: string;
      ttlSeconds: number;
      options: Record<string, string | null>;
    }
  | { available: false; provider: "twilio" | "telnyx" | null; reason: string };

export type WhatsAppCallDto = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  status:
    | "RINGING"
    | "ACCEPTED"
    | "COMPLETED"
    | "REJECTED"
    | "MISSED"
    | "FAILED";
  leadId: number | null;
  leadName: string | null;
  customerPhoneE164: string;
  businessDisplayNumber: string;
  staffName: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  failureReason: string | null;
  needsReconciliation: boolean;
  remoteSdp: string | null;
};

export type WhatsAppCallPermissionDto = {
  enabled: boolean;
  status: "NONE" | "REQUESTED" | "GRANTED" | "REJECTED" | "EXPIRED";
  permanent: boolean;
  expiresAt: string | null;
  canCall: boolean;
  canRequest: boolean;
  reason: string | null;
};

/** What every member of staff may read: whether to show the buttons. */
export type CommsAvailabilityDto = {
  smsAvailable: boolean;
  callsAvailable: boolean;
};

/** The full configuration, for an admin only. */
export type CommsStatusDto = CommsAvailabilityDto & {
  activeProvider: "twilio" | "telnyx" | null;
  smsEnabled: boolean;
  callsEnabled: boolean;
  browserCalling: boolean;
  /** Inbound calls are answered by Mili. */
  voiceAgent: boolean;
  recordingMode: "off" | "consented";
  staffForwardNumber: string | null;
  webhookOrigin: string | null;
  numbers: { e164: string; label: string; provider: "twilio" | "telnyx" }[];
  problems: string[];
  capabilities: Record<string, boolean | string> | null;
};
