import type {
  CommsBusinessNumber,
  CommsChannel,
  CommsProviderName,
  RecordingMode,
} from "@/lib/domain/ports/comms";
import { carrierNumberToE164 } from "@/lib/domain/comms/shared";

import { VOICE_AGENT_SECRET_MIN_LENGTH } from "./voice-agent/token";

// SMS and phone configuration, read from the environment.
//
// Node-safe on purpose — no `server-only`, no Next — so a cron, a workflow
// step and Eve can all build the same adapter. Secrets stay here and inside
// the adapters; the rest of the app sees `CommsChannel`. `.env.example`
// documents every variable, docs/comms-runbook.md says where each comes from.
//
// Switching provider is COMMUNICATIONS_PROVIDER plus that provider's
// credentials and numbers (file 06 §5). No migration, no code change.

export const COMMS_PROVIDERS: readonly CommsProviderName[] = [
  "twilio",
  "telnyx",
];

export type TwilioConfig = {
  readonly accountSid: string | null;
  readonly authToken: string | null;
  /** Accepted for webhook signatures during an Auth Token rotation. */
  readonly previousAuthToken: string | null;
  /** API key for REST and for browser tokens; Account SID/Token if absent. */
  readonly apiKeySid: string | null;
  readonly apiKeySecret: string | null;
  /** https://api.twilio.com unless TWILIO_API_BASE says otherwise. */
  readonly apiBase: string;
  /** Voice SDK edge for browsers, e.g. "sydney". */
  readonly edge: string | null;
};

export type TelnyxConfig = {
  readonly apiKey: string | null;
  /** Base64 Ed25519 public key from Mission Control, for webhooks. */
  readonly publicKey: string | null;
  /** Call Control Application id used to place calls. */
  readonly connectionId: string | null;
  /** Credential connection the browser logins belong to. */
  readonly webrtcConnectionId: string | null;
  readonly messagingProfileId: string | null;
};

/**
 * Mili, the voice agent. The carrier — Twilio or Telnyx — streams an answered
 * inbound call's audio over a WebSocket to this app
 * (/api/comms/voice-agent/<provider>), which bridges it to the live model on
 * AI Gateway. Off unless COMMS_AGENT_ENABLED is "true" and the secret is set.
 */
export type VoiceAgentConfig = {
  readonly enabled: boolean;
  /** Signs the token a carrier's stream must present (voice-agent/token.ts). */
  readonly secret: string | null;
  /**
   * Mili answers resolved callers from Royal's records (issue #528). Off
   * unless COMMS_AGENT_DISCLOSURE_ENABLED is "true", and separate from
   * `enabled`: switching it off stops every disclosure and leaves her taking
   * messages.
   */
  readonly disclosure: boolean;
};

export type CommsConfig = {
  /** The provider that carries new outbound work. Null when misconfigured. */
  readonly provider: CommsProviderName | null;
  readonly smsEnabled: boolean;
  readonly callsEnabled: boolean;
  /** The public origin providers call; every signature covers it. */
  readonly webhookOrigin: string | null;
  readonly numbers: readonly CommsBusinessNumber[];
  readonly recordingMode: RecordingMode;
  readonly staffForwardNumber: string | null;
  readonly twilio: TwilioConfig;
  readonly telnyx: TelnyxConfig;
  readonly voiceAgent: VoiceAgentConfig;
  /** Misconfigurations worth a log line, never containing a secret. */
  readonly problems: readonly string[];
};

type Env = Record<string, string | undefined>;

function value(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  return raw ? raw : null;
}

function flag(env: Env, name: string): boolean {
  return env[name]?.trim() === "true";
}

/**
 * COMMS_PHONE_NUMBERS: `<E.164>=<provider>=<label>`, comma-separated.
 *
 *   COMMS_PHONE_NUMBERS="+61280001234=twilio=Office,+61290001234=telnyx=Office"
 *
 * A number names the carrier it lives with: numbers do not move when the
 * active provider changes (porting is a carrier process). A malformed entry is
 * dropped and reported rather than half-used.
 */
export function parseCommsPhoneNumbers(raw: string | null): {
  numbers: CommsBusinessNumber[];
  problems: string[];
} {
  const numbers: CommsBusinessNumber[] = [];
  const problems: string[] = [];
  if (!raw) return { numbers, problems };
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry, index) => {
      const [number, provider, ...labelParts] = entry
        .split("=")
        .map((part) => part.trim());
      const e164 = carrierNumberToE164(number);
      const label = labelParts.join("=").trim();
      if (!e164) {
        problems.push(
          `COMMS_PHONE_NUMBERS entry ${index + 1} has no valid E.164 number.`,
        );
        return;
      }
      if (!COMMS_PROVIDERS.includes(provider as CommsProviderName)) {
        problems.push(
          `COMMS_PHONE_NUMBERS entry ${index + 1} names provider "${provider ?? ""}"; use ${COMMS_PROVIDERS.join(" or ")}.`,
        );
        return;
      }
      if (numbers.some((existing) => existing.e164 === e164)) {
        problems.push(`COMMS_PHONE_NUMBERS lists ${e164} more than once.`);
        return;
      }
      numbers.push({
        e164,
        label: label || e164,
        provider: provider as CommsProviderName,
      });
    });
  return { numbers, problems };
}

/**
 * COMMUNICATIONS_PROVIDER (legacy alias COMMS_PROVIDER). Unset means Twilio,
 * so an existing deployment does not change. An unknown value fails loudly —
 * the channel is off and the problem names the allowed values — rather than
 * quietly falling back to a provider nobody chose.
 */
export function readActiveProvider(env: Env): {
  provider: CommsProviderName | null;
  problem: string | null;
} {
  const raw = (
    value(env, "COMMUNICATIONS_PROVIDER") ?? value(env, "COMMS_PROVIDER")
  )?.toLowerCase();
  if (!raw) return { problem: null, provider: "twilio" };
  if (COMMS_PROVIDERS.includes(raw as CommsProviderName)) {
    return { problem: null, provider: raw as CommsProviderName };
  }
  return {
    problem: `COMMUNICATIONS_PROVIDER is "${raw}"; it must be one of ${COMMS_PROVIDERS.join(", ")}. SMS and calls are off until it is fixed.`,
    provider: null,
  };
}

function origin(env: Env, problems: string[]): string | null {
  const raw =
    value(env, "COMMS_WEBHOOK_ORIGIN") ?? value(env, "NEXT_PUBLIC_APP_URL");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      problems.push(
        "COMMS_WEBHOOK_ORIGIN must be https: carriers will not call plain http.",
      );
    }
    return url.origin;
  } catch {
    problems.push("COMMS_WEBHOOK_ORIGIN is not a URL.");
    return null;
  }
}

function voiceAgent(env: Env, problems: string[]): VoiceAgentConfig {
  if (!flag(env, "COMMS_AGENT_ENABLED"))
    return { disclosure: false, enabled: false, secret: null };
  const secret = value(env, "COMMS_AGENT_SECRET");
  if (!secret || secret.length < VOICE_AGENT_SECRET_MIN_LENGTH) {
    problems.push(
      `COMMS_AGENT_SECRET must be set to at least ${VOICE_AGENT_SECRET_MIN_LENGTH} random characters; Mili is off.`,
    );
    return { disclosure: false, enabled: false, secret: null };
  }
  return {
    disclosure: flag(env, "COMMS_AGENT_DISCLOSURE_ENABLED"),
    enabled: true,
    secret,
  };
}

export function readCommsConfig(env: Env = process.env): CommsConfig {
  const problems: string[] = [];
  const active = readActiveProvider(env);
  if (active.problem) problems.push(active.problem);
  const parsed = parseCommsPhoneNumbers(value(env, "COMMS_PHONE_NUMBERS"));
  problems.push(...parsed.problems);
  const forwardRaw = value(env, "COMMS_STAFF_FORWARD_NUMBER");
  const staffForwardNumber = forwardRaw
    ? carrierNumberToE164(forwardRaw)
    : null;
  if (forwardRaw && !staffForwardNumber) {
    problems.push("COMMS_STAFF_FORWARD_NUMBER is not a valid phone number.");
  }
  const mode = value(env, "COMMS_RECORDING_MODE") ?? "off";
  if (mode !== "off" && mode !== "consented") {
    problems.push(
      'COMMS_RECORDING_MODE must be "off" or "consented"; recording is off.',
    );
  }
  const smsEnabled = flag(env, "COMMS_SMS_ENABLED");
  const callsEnabled = flag(env, "COMMS_CALLS_ENABLED");
  const webhookOrigin = origin(env, problems);
  const agent = voiceAgent(env, problems);
  if ((smsEnabled || callsEnabled) && !webhookOrigin) {
    problems.push(
      "COMMS_WEBHOOK_ORIGIN is not set, so carriers have nowhere to report back.",
    );
  }
  if (
    (smsEnabled || callsEnabled)
    && active.provider
    && !parsed.numbers.some((number) => number.provider === active.provider)
  ) {
    problems.push(
      `COMMS_PHONE_NUMBERS has no number on ${active.provider}, the active provider.`,
    );
  }
  return {
    callsEnabled,
    numbers: parsed.numbers,
    problems,
    provider: active.provider,
    recordingMode: mode === "consented" ? "consented" : "off",
    smsEnabled,
    staffForwardNumber,
    telnyx: {
      apiKey: value(env, "TELNYX_API_KEY"),
      connectionId: value(env, "TELNYX_CONNECTION_ID"),
      messagingProfileId: value(env, "TELNYX_MESSAGING_PROFILE_ID"),
      publicKey: value(env, "TELNYX_PUBLIC_KEY"),
      webrtcConnectionId: value(env, "TELNYX_WEBRTC_CONNECTION_ID"),
    },
    twilio: {
      accountSid: value(env, "TWILIO_ACCOUNT_SID"),
      apiBase: (
        value(env, "TWILIO_API_BASE") ?? "https://api.twilio.com"
      ).replace(/\/+$/, ""),
      apiKeySecret: value(env, "TWILIO_API_KEY_SECRET"),
      apiKeySid: value(env, "TWILIO_API_KEY_SID"),
      authToken: value(env, "TWILIO_AUTH_TOKEN"),
      edge: value(env, "TWILIO_EDGE"),
      previousAuthToken: value(env, "TWILIO_PREVIOUS_AUTH_TOKEN"),
    },
    voiceAgent: agent,
    webhookOrigin,
  };
}

/** Can this provider talk to its REST API at all? */
export function providerConfigured(
  config: CommsConfig,
  provider: CommsProviderName,
): boolean {
  if (provider === "twilio") {
    const t = config.twilio;
    return Boolean(
      t.accountSid && (t.authToken || (t.apiKeySid && t.apiKeySecret)),
    );
  }
  return Boolean(config.telnyx.apiKey);
}

/** Can this provider ring a browser (issue a credential)? */
export function browserCallingConfigured(
  config: CommsConfig,
  provider: CommsProviderName,
): boolean {
  if (provider === "twilio") {
    return Boolean(
      config.twilio.accountSid
      && config.twilio.apiKeySid
      && config.twilio.apiKeySecret,
    );
  }
  return Boolean(config.telnyx.apiKey && config.telnyx.webrtcConnectionId);
}

/**
 * Can inbound calls be handed to Mili? Both carriers stream call audio
 * (Twilio Media Streams, Telnyx media streaming) to the same route, so this
 * does not depend on which carrier is active.
 */
export function voiceAgentConfigured(config: CommsConfig): boolean {
  return (
    config.callsEnabled
    && config.voiceAgent.enabled
    && Boolean(config.voiceAgent.secret && config.webhookOrigin)
  );
}

/** The non-secret channel the domain is handed. */
export function commsChannel(config: CommsConfig): CommsChannel | null {
  const provider = config.provider;
  if (!provider || (!config.smsEnabled && !config.callsEnabled)) return null;
  const configured =
    providerConfigured(config, provider) && Boolean(config.webhookOrigin);
  const callsConfigured =
    provider === "twilio"
      ? configured
      : configured && Boolean(config.telnyx.connectionId);
  return {
    browserCalling:
      config.callsEnabled && browserCallingConfigured(config, provider),
    callsAvailable: config.callsEnabled && callsConfigured,
    defaultNumber:
      config.numbers.find((number) => number.provider === provider) ?? null,
    numbers: config.numbers,
    provider,
    recordingMode: config.recordingMode,
    smsAvailable: config.smsEnabled && configured,
    staffForwardNumber: config.staffForwardNumber,
    voiceAgent: callsConfigured && voiceAgentConfigured(config),
  };
}
