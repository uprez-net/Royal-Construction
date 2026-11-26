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
  staffTarget: "BROWSER" | "MOBILE" | "AGENT" | null;
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
  /** The project it is filed on: placed from its dialer, or matched. */
  projectId: string | null;
  projectName: string | null;
  /** Who on the project was called, or who called. */
  contactKind: ProjectCallContactKindDto | null;
  contactName: string | null;
  /** Inbound: whether the project matcher filed it, and why. */
  projectMatch: "MATCHED" | "NO_MATCH" | "FAILED" | null;
  projectMatchReason: string | null;
  /** A matched inbound call nobody has opened on the project yet. */
  projectUnread: boolean;
};

export type ProjectCallContactKindDto =
  | "SITE_MANAGER"
  | "OWNER"
  | "TRADIE"
  | "OTHER";

/** One of a project's people, as the dialer lists them. */
export type ProjectCallContactDto = {
  /** What a call is placed to; the server looks the number up again. */
  ref: string;
  kind: ProjectCallContactKindDto;
  name: string;
  role: string;
  e164: string | null;
  problem: string | null;
};

export type ProjectCallsDto = {
  calls: CallDto[];
  contacts: ProjectCallContactDto[];
  options: Omit<LeadCallsDto["options"], "to">;
  unread: number;
};

/** Whose number a team call came from (lib/domain/comms/team-callers.ts). */
export type TeamCallerDto = {
  e164: string;
  name: string;
  kind: "staff" | "team_phone" | "office_mobile";
  role: "ADMIN" | "SITE_MANAGER" | "CUSTOMER" | "GUEST" | null;
};

/** The admin page's inbound lists. */
export type UnmatchedCommsDto = {
  sms: SmsMessageDto[];
  /** From numbers no single lead owns, and not the team's. */
  calls: CallDto[];
  /** From the team's own numbers. */
  teamCalls: { call: CallDto; caller: TeamCallerDto }[];
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

/** The owner line: where Mili rings with a briefing Hermes asked for. */
export type OwnerLineDto = { nickname: string; e164: string };

export type OwnerCallStatusDto =
  | "SCHEDULED"
  | "PLACING"
  | "PLACED"
  | "CANCELED"
  | "FAILED";

/** A call Mili makes to the owner for Hermes (Admin → Agent calls). */
export type OwnerCallDto = {
  id: string;
  status: OwnerCallStatusDto;
  callAt: string;
  placedAt: string | null;
  canceledAt: string | null;
  failureReason: string | null;
  source: string;
  category: string;
  subject: string;
  reference: string | null;
  eventAt: string | null;
  questionsAsked: number;
  to: string | null;
  createdAt: string;
  call: {
    callId: string;
    status: CallStatusDto;
    flowStep: string;
    answered: boolean;
    answeredAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
    needsReconciliation: boolean;
    problem: string | null;
    transcript: string | null;
    recordings: { id: string; available: boolean; transcript: string | null }[];
  } | null;
};

export type AgentCallEventDto = {
  id: string;
  kind: string;
  occurredAt: string;
  detail: Record<string, unknown> | null;
};

export type OwnerCallDetailDto = OwnerCallDto & {
  agenda: string[];
  context: string;
  callRecord: CallDto | null;
  events: AgentCallEventDto[];
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
  /**
   * Mili answers callers the records recognise from those records
   * (COMMS_AGENT_DISCLOSURE_ENABLED). Off: she takes messages only.
   */
  voiceAgentDisclosure: boolean;
  recordingMode: "off" | "consented";
  staffForwardNumber: string | null;
  webhookOrigin: string | null;
  numbers: { e164: string; label: string; provider: "twilio" | "telnyx" }[];
  problems: string[];
  capabilities: Record<string, boolean | string> | null;
  /** HERMES_MCP_SECRET is set: Hermes can ask Mili to ring the owner line. */
  hermesCalls: boolean;
  /** HERMES_SERVER_MCP_URL and _TOKEN are set: Mili can pass the owner's questions to Hermes. */
  hermesAssistant: boolean;
  /** Where Hermes connects, for its MCP config. */
  hermesEndpoint: string | null;
};
