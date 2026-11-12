// Which models Mili runs on, and how she sounds. Read by the stream relay
// (lib/comms/voice-agent) only; what she says is in
// lib/domain/comms/calls/voice-agent.ts.

/**
 * Her voice: OpenAI's GPT-Live, reached through AI Gateway's native Live
 * socket (live.ts) and billed per session hour.
 *
 * Live is not the realtime API: it has its own endpoint and protocol, so
 * swapping a realtime model's slug for this one does not select it (AI
 * Gateway refuses it there with `invalid_model`). It cannot call tools
 * either — the call desk below decides when the call moves on.
 */
export const VOICE_AGENT_MODEL = "openai/gpt-live-1";

/**
 * The call desk (desk.ts): a fast text model on AI Gateway that reads the
 * conversation and calls end_call / transfer_to_team for her. Chosen on
 * 2026-11-12 for being right on every probe transcript, including not
 * transferring before Mili has told the caller, in about a second.
 */
export const VOICE_AGENT_DESK_MODEL = "zai/glm-5.3-flash";

/**
 * A female voice. "marin" is OpenAI's most natural voice and GPT-Live's
 * default; set COMMS_AGENT_VOICE to another female voice ("coral",
 * "shimmer", "sage") to change it without a deploy of the app.
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
