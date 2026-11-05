import type {
  CommsChannel,
  CommsProviderName,
  RecordingPort,
  SmsPort,
  VoicePort,
} from "@/lib/domain/ports/comms";

import { commsChannel, COMMS_PROVIDERS, readCommsConfig, type CommsConfig } from "./config";
import type { Fetch } from "./http";
import { createTelnyxAdapter } from "./providers/telnyx";
import { createTwilioAdapter } from "./providers/twilio";
import type { CommsAdapter } from "./types";

// The only place a provider is chosen (file 06 §4).
//
//   - New outbound work uses the ACTIVE provider (COMMUNICATIONS_PROVIDER).
//   - Existing work — ending a call, fetching its recording, handling its
//     callback — uses the provider that OWNS it, so changing the setting mid-day
//     never strands a call that is already ringing.
//   - Inbound webhooks name their provider in the path.
//
// Adapters are built lazily: a deployment that never uses Telnyx never needs
// Telnyx credentials, and missing ones surface as `config` errors only when
// that adapter is used. This table is the only `switch` on a provider.

const BUILDERS: Record<CommsProviderName, (config: CommsConfig, fetchImpl: Fetch) => CommsAdapter> = {
  telnyx: createTelnyxAdapter,
  twilio: createTwilioAdapter,
};

export function commsAdapter(
  name: CommsProviderName,
  config: CommsConfig = readCommsConfig(),
  fetchImpl: Fetch = fetch,
): CommsAdapter {
  return BUILDERS[name](config, fetchImpl);
}

/** A provider named in a webhook path, or null for anything else (a 404). */
export function providerFromPath(segment: string): CommsProviderName | null {
  return COMMS_PROVIDERS.includes(segment as CommsProviderName)
    ? (segment as CommsProviderName)
    : null;
}

export type CommsRuntime = {
  readonly config: CommsConfig;
  readonly channel: CommsChannel | null;
  /** The active provider's adapter, for new outbound work. */
  readonly active: CommsAdapter | null;
  readonly sms: SmsPort | null;
  readonly voice: VoicePort | null;
  /** The adapter that owns existing work. */
  readonly adapterFor: (provider: CommsProviderName) => CommsAdapter;
  readonly voiceFor: (provider: CommsProviderName) => VoicePort | null;
  readonly recordingsFor: (provider: CommsProviderName) => RecordingPort | null;
};

/** Everything an App route, a cron or a workflow step needs, from one config read. */
export function commsRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: Fetch = fetch,
): CommsRuntime {
  const config = readCommsConfig(env);
  const channel = commsChannel(config);
  const built = new Map<CommsProviderName, CommsAdapter>();
  const adapterFor = (provider: CommsProviderName) => {
    const existing = built.get(provider);
    if (existing) return existing;
    const adapter = commsAdapter(provider, config, fetchImpl);
    built.set(provider, adapter);
    return adapter;
  };
  const active = channel ? adapterFor(channel.provider) : null;
  return {
    active,
    adapterFor,
    channel,
    config,
    recordingsFor: (provider) => adapterFor(provider).recordings,
    sms: channel?.smsAvailable ? (active?.sms ?? null) : null,
    voice: channel?.callsAvailable ? (active?.voice ?? null) : null,
    voiceFor: (provider) => adapterFor(provider).voice,
  };
}
