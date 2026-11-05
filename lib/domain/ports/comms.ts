// SMS and phone calls, as the domain sees them.
//
// lib/domain/comms decides who may be texted or rung, from which Royal
// number, what a call does next, and how many times. These ports are only the
// capability to hand a decided message or call to a carrier. The adapters are
// lib/comms/providers/{twilio,telnyx}; COMMUNICATIONS_PROVIDER picks which one
// carries new outbound work (docs/twilio-plivo-comms/06).
//
// Nothing here names a vendor's wire format. A provider id is an opaque
// string: Twilio's `CA…`, Telnyx's `v3:…`, a Plivo UUID one day. Never parse
// it, never validate its shape — a Twilio-shaped regex is how a second provider
// gets silently ignored (file 06 §1.1).

/** Which carrier owns a message, a call or a recording. */
export type CommsProviderName = "twilio" | "telnyx";

/** One Royal phone number, as configured for this deployment. */
export type CommsBusinessNumber = {
  /** E.164, with the leading "+". */
  readonly e164: string;
  /** What the office calls it ("Office", "Sales"). */
  readonly label: string;
  /** The carrier the number lives with. Numbers do not move by config. */
  readonly provider: CommsProviderName;
};

/** Royal's recording policy. `consented` asks the customer first. */
export type RecordingMode = "off" | "consented";

/** The non-secret shape of the channel, safe to show an operator. */
export type CommsChannel = {
  /** The provider that carries new outbound work. */
  readonly provider: CommsProviderName;
  readonly numbers: readonly CommsBusinessNumber[];
  /** The active provider's sender: the first of its numbers. */
  readonly defaultNumber: CommsBusinessNumber | null;
  /** COMMS_SMS_ENABLED and the active provider is configured to send. */
  readonly smsAvailable: boolean;
  /** COMMS_CALLS_ENABLED and the active provider can place calls. */
  readonly callsAvailable: boolean;
  /** The provider can ring a staff browser (it issues credentials). */
  readonly browserCalling: boolean;
  /**
   * The provider can ring several browsers at once. Twilio dials every
   * identity in one <Dial>; Telnyx transfers to one SIP endpoint.
   */
  readonly browserRingGroup: boolean;
  readonly recordingMode: RecordingMode;
  /** The office mobile calls fall back to, E.164, or null. */
  readonly staffForwardNumber: string | null;
};

// ── Errors ────────────────────────────────────────────────────────────

/**
 * Why a carrier call did not produce a result (file 06 §3.2).
 *
 * - `rejected`: the carrier answered and refused (a 4xx other than 429).
 *   Nothing was sent or placed; the same intent may be tried again.
 * - `uncertain`: a timeout, a dropped connection, a 5xx or a 429. It may
 *   have happened. Never blind-retried: a duplicate text or a second ring on
 *   a customer's phone is the expensive outcome.
 * - `unsupported`: this provider cannot do it. Never a silent no-op.
 * - `config`: credentials or settings are missing. Nothing left the server.
 */
export type CommsErrorKind =
  | "rejected"
  | "uncertain"
  | "unsupported"
  | "config";

export class CommsError extends Error {
  constructor(
    /** Operator-readable. Never carries a token, a body or a stack. */
    message: string,
    readonly kind: CommsErrorKind,
    /** e.g. TWILIO_21211, TELNYX_40300, TELNYX_HTTP_503. */
    readonly providerCode: string | null = null,
    /** The carrier's HTTP status, when it answered with an error. */
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "CommsError";
  }
}

export function isCommsError(error: unknown): error is CommsError {
  return error instanceof CommsError;
}

/** Nothing reached the customer, so the intent may be tried again. */
export function commsDefinitelyNotSent(error: unknown): boolean {
  return isCommsError(error) && error.kind !== "uncertain";
}

// ── SMS ───────────────────────────────────────────────────────────────

export type SmsPort = {
  readonly provider: CommsProviderName;
  /** Throws CommsError. */
  readonly sendSms: (message: {
    readonly from: string;
    readonly to: string;
    readonly body: string;
  }) => Promise<{ readonly providerMessageId: string }>;
};

// ── Voice ─────────────────────────────────────────────────────────────

/** The persisted call vocabulary, lower-case as providers spell it. */
export type CallState =
  | "queued"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled";

export type PlaceCallRequest = {
  /** Royal's Call.id: every callback for this call carries it. */
  readonly callId: string;
  readonly from: string;
  readonly to: string;
  /** How long the customer's phone rings. */
  readonly timeoutSeconds: number;
  /** Whole-call ceiling. */
  readonly timeLimitSeconds: number;
};

export type ProviderCallLookup =
  | {
      readonly found: true;
      /**
       * Null when the provider only says the call is no longer alive (Telnyx)
       * without saying how it ended.
       */
      readonly state: CallState | null;
      readonly alive: boolean;
      readonly durationSeconds: number | null;
    }
  | { readonly found: false };

export type VoicePort = {
  readonly provider: CommsProviderName;
  /** Ring a customer. Throws CommsError. */
  readonly placeCall: (
    request: PlaceCallRequest,
  ) => Promise<{ readonly providerCallId: string }>;
  /** Cancel a ringing call or end an answered one. Idempotent on an ended call. */
  readonly endCall: (providerCallId: string) => Promise<void>;
  readonly lookupCall: (providerCallId: string) => Promise<ProviderCallLookup>;
};

// ── Recordings ────────────────────────────────────────────────────────

export type RecordingDownload = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export type RecordingPort = {
  readonly provider: CommsProviderName;
  /** Built from the recording id, never from a URL a callback supplied (SSRF). */
  readonly fetchRecording: (
    providerRecordingId: string,
    options: { readonly maxBytes: number },
  ) => Promise<RecordingDownload>;
  /** Idempotent: an already-deleted recording is success. */
  readonly deleteRecording: (providerRecordingId: string) => Promise<void>;
};

// ── Call instructions ─────────────────────────────────────────────────
//
// The domain decides what a call does next as neutral steps (file 01 §5). A
// markup provider (Twilio) renders them into the webhook's response; a
// command provider (Telnyx) issues them as REST commands on the live call.
// Callback URLs are the adapter's: a step names *what* happens, and the
// adapter knows where the provider reports back.

export type CallInstruction =
  | { readonly op: "say"; readonly text: string }
  | {
      readonly op: "gatherDigits";
      /** Spoken while waiting for a key press. */
      readonly prompt: string;
      readonly numDigits: number;
      readonly timeoutSeconds: number;
    }
  | {
      readonly op: "dialBrowser";
      /** Staff browser identities (see `browserIdentity`). */
      readonly identities: readonly string[];
      readonly callerId: string;
      readonly timeoutSeconds: number;
      readonly record: boolean;
    }
  | {
      readonly op: "dialNumber";
      readonly to: string;
      readonly callerId: string;
      readonly timeoutSeconds: number;
      readonly record: boolean;
    }
  | {
      readonly op: "recordVoicemail";
      readonly maxSeconds: number;
    }
  | { readonly op: "hangup" };

/**
 * The browser identity for a staff user: what a credential is issued for and
 * what an inbound call rings. Alphanumeric and underscore only, which every
 * provider accepts.
 */
export function browserIdentity(userId: string): string {
  return `crm_${userId.replace(/[^A-Za-z0-9]/g, "")}`;
}

// ── Events ────────────────────────────────────────────────────────────
//
// What an adapter's webhook parser hands the domain. Numbers are E.164.
// `providerCallId` is the customer's leg. `callId` is Royal's own id, when the
// callback URL or client state carried it.

export type DialOutcome =
  | "answered"
  | "no-answer"
  | "busy"
  | "failed"
  | "canceled";

export type CommsEvent =
  | {
      readonly type: "sms.received";
      readonly providerMessageId: string;
      readonly from: string;
      readonly to: string;
      readonly body: string;
      readonly mediaCount: number;
      readonly receivedAt: Date;
    }
  | {
      readonly type: "sms.status";
      readonly providerMessageId: string;
      readonly status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED";
      readonly errorCode: string | null;
      readonly occurredAt: Date;
    }
  | {
      readonly type: "call.incoming";
      readonly providerCallId: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      /** The customer picked up (outbound), or the provider answered (inbound). */
      readonly type: "call.answered";
      readonly providerCallId: string;
      readonly callId: string | null;
    }
  | {
      readonly type: "call.status";
      readonly providerCallId: string;
      readonly callId: string | null;
      readonly state: CallState;
      readonly durationSeconds: number | null;
      readonly hangupCause: string | null;
      readonly occurredAt: Date;
    }
  | {
      readonly type: "call.gathered";
      readonly providerCallId: string;
      readonly callId: string | null;
      /** Empty when the caller pressed nothing. */
      readonly digits: string;
    }
  | {
      /** A staff leg answered and the customer is now talking to someone. */
      readonly type: "call.connected";
      readonly providerCallId: string | null;
      readonly callId: string | null;
    }
  | {
      /** A dial step finished: the staff leg answered and hung up, or never did. */
      readonly type: "call.dialed";
      readonly providerCallId: string;
      readonly callId: string | null;
      readonly outcome: DialOutcome;
      readonly durationSeconds: number | null;
    }
  | {
      readonly type: "call.recording";
      readonly providerCallId: string;
      readonly callId: string | null;
      readonly providerRecordingId: string;
      readonly durationSeconds: number | null;
    };
