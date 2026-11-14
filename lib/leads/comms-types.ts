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
  }[];
  /** What the caller and Mili said, one "Speaker: text" line per turn. */
  agentTranscript: string | null;
};

export type LeadCallsDto = {
  calls: CallDto[];
  options: {
    allowed: boolean;
    reason: string | null;
    to: string | null;
    browser: boolean;
    mobile: boolean;
  };
};

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
