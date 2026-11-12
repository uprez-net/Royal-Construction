// Which live model Mili runs on, and how she sounds. Read by the relay
// (services/voice-agent) only; what she says is in
// lib/domain/comms/calls/voice-agent.ts.

/**
 * OpenAI's realtime speech-to-speech model, reached through AI Gateway.
 *
 * It must be one AI Gateway serves over its realtime WebSocket (tagged
 * `websocket-realtime` in its model list). `openai/gpt-live-1` is listed but
 * not served that way: every session failed with `invalid_model`, so Mili
 * never answered and each caller went straight to the office mobile.
 */
export const VOICE_AGENT_MODEL = "openai/gpt-realtime-2";

/**
 * A female voice. "marin" is OpenAI's most natural realtime voice; set
 * COMMS_AGENT_VOICE to another female voice ("coral", "shimmer", "sage") to
 * change it without a deploy of the app.
 */
export const VOICE_AGENT_DEFAULT_VOICE = "marin";

export const VOICE_AGENT_FEMALE_VOICES: readonly string[] = [
  "marin",
  "coral",
  "shimmer",
  "sage",
];

export function voiceAgentVoice(
  env: Record<string, string | undefined> = process.env,
): string {
  const chosen = env.COMMS_AGENT_VOICE?.trim().toLowerCase();
  return chosen && VOICE_AGENT_FEMALE_VOICES.includes(chosen)
    ? chosen
    : VOICE_AGENT_DEFAULT_VOICE;
}
