import type {
  CallInstruction,
  CommsEvent,
  CommsProviderName,
  RecordingPort,
  SmsPort,
  VoicePort,
} from "@/lib/domain/ports/comms";

// What a carrier adapter is (file 06 §3). The only code that knows a wire
// format, signs a request or verifies a signature lives behind this.

export type CommsCapabilities = {
  readonly sms: boolean;
  readonly outboundCalls: boolean;
  readonly browserCalling: boolean;
  /** The app ships a browser SDK for this provider (components/comms/dialer). */
  readonly browserSdkBundled: boolean;
  readonly browserRingGroup: boolean;
  /** "markup": answer the webhook with call XML. "commands": REST on the live call. */
  readonly callControl: "markup" | "commands";
  readonly inboundCallFlow: boolean;
  readonly recordings: boolean;
};

export type IceServer = {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
};

/** A short-lived browser login. Never an API secret. */
export type BrowserCredential = {
  readonly provider: CommsProviderName;
  readonly identity: string;
  readonly token: string;
  readonly ttlSeconds: number;
  /** Non-secret options the dialer needs (Twilio edge, Telnyx login mode). */
  readonly options: Readonly<Record<string, string | null>>;
};

export type WebhookRequest = {
  /** The path segment after /api/comms/<provider>/. */
  readonly event: string;
  /** The URL the carrier signed: COMMS_WEBHOOK_ORIGIN + path + query. */
  readonly signedUrl: string;
  readonly query: URLSearchParams;
  readonly headers: Headers;
  readonly rawBody: string;
  readonly now: Date;
};

/** Instructions the adapter carries on its own, without the domain. */
export type PendingInstructions = {
  readonly providerCallId: string;
  readonly callId: string | null;
  readonly instructions: readonly CallInstruction[];
};

export type ParsedWebhook = {
  readonly events: readonly CommsEvent[];
  /** The carrier's event id, for skipping a retried delivery. Null for markup requests. */
  readonly dedupeKey: string | null;
  /** "markup": the carrier waits for call XML in the response. */
  readonly respondWith: "markup" | "ack";
  /** A continuation of earlier instructions (Telnyx: after speech ended). */
  readonly pending?: PendingInstructions | null;
  /**
   * A staff leg answered on a call the customer agreed to record, and this
   * provider records with a separate command once both parties are talking
   * (Telnyx). Markup providers record inside the dial verb instead.
   */
  readonly recordAfterConnect?: {
    readonly providerCallId: string;
    readonly callId: string | null;
  } | null;
  /** Why it was ignored, for the log. Never a number or a body. */
  readonly ignoredReason?: string;
};

export type RespondContext = {
  readonly providerCallId: string | null;
  readonly callId: string | null;
  /** The event that led here; a command adapter answers an incoming call first. */
  readonly trigger: CommsEvent["type"] | "continuation" | null;
};

export type CommsAdapter = {
  readonly name: CommsProviderName;
  readonly capabilities: CommsCapabilities;
  /** Null when this provider is not configured to do it. */
  readonly sms: SmsPort | null;
  readonly voice: VoicePort | null;
  readonly recordings: RecordingPort | null;
  readonly issueBrowserCredential:
    | ((identity: string, ttlSeconds: number) => Promise<BrowserCredential>)
    | null;
  /** The webhook events this provider posts to. Anything else is a 404. */
  readonly webhookEvents: ReadonlySet<string>;
  /** Signature check over the exact bytes. False is a 403 with no DB access. */
  readonly verifyWebhook: (request: WebhookRequest) => boolean;
  /** Null: signed, but not a shape this adapter understands (400). */
  readonly parseWebhook: (request: WebhookRequest) => ParsedWebhook | null;
  /**
   * Turn instructions into the HTTP answer: call XML for a markup provider,
   * REST commands then an empty 200 for a command provider.
   */
  readonly respond: (
    instructions: readonly CallInstruction[] | null,
    context: RespondContext,
  ) => Promise<Response>;
  /**
   * Short-lived TURN servers for a browser's WebRTC leg (WhatsApp calling),
   * for networks that block UDP. Absent when this provider offers none.
   */
  readonly iceServers?: () => Promise<readonly IceServer[]>;
  /** See `ParsedWebhook.recordAfterConnect`. Absent for markup providers. */
  readonly startCallRecording?: (providerCallId: string, callId: string | null) => Promise<void>;
};
