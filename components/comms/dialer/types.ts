// The browser phone, provider-neutral (docs/twilio-plivo-comms/06 §8).
//
// The dock and the call buttons talk to this; a vendor SDK hides behind one
// implementation each (twilio-dialer.ts, telnyx-dialer.ts). The credential
// can only receive calls: CRM calls are placed by the server and bridged to
// the browser, so there is no `dial` here on purpose.

export type DialerCredential = {
  provider: "twilio" | "telnyx";
  identity: string;
  token: string;
  ttlSeconds: number;
  options: Record<string, string | null>;
};

export type IncomingCall = {
  /** Royal's Call.id, when the server put it on the leg. */
  callId: string | null;
  /** The caller as the provider presented it. */
  from: string | null;
};

export type DialerEvents = {
  onReady: () => void;
  onError: (message: string) => void;
  onIncoming: (call: IncomingCall) => void;
  /** The current call was answered here and audio is flowing. */
  onConnected: () => void;
  /** The current call ended, however it ended. */
  onEnded: () => void;
};

export interface Dialer {
  readonly provider: "twilio" | "telnyx";
  register(credential: DialerCredential): Promise<void>;
  /** A fresh credential before the old one expires. */
  refresh(credential: DialerCredential): Promise<void>;
  answer(): Promise<void>;
  reject(): void;
  hangup(): void;
  mute(muted: boolean): void;
  /** Touch-tones on the live call: a supplier's menu, an extension. */
  sendDigits(digits: string): void;
  /** The live call's audio, for the level meters; null before the SDK has it. */
  audioStreams(): CallAudioStreams;
  destroy(): void;
}

export type CallAudioStreams = {
  /** This person's microphone, as sent. */
  local: MediaStream | null;
  /** The other party, as heard. */
  remote: MediaStream | null;
};
