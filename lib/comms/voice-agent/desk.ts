import { gateway, generateText, jsonSchema, tool } from "ai";

import {
  formatVoiceAgentTranscript,
  VOICE_AGENT_TOOLS,
  voiceAgentDeskInstructions,
  type VoiceAgentTurn,
} from "@/lib/domain/comms/calls/voice-agent";

import { VOICE_AGENT_DESK_MODEL } from "./settings";

// The call desk: the second model behind Mili.
//
// GPT-Live carries the conversation but cannot call tools, so after each
// thing Mili says (and whenever Live delegates) this asks a fast text model on
// AI Gateway whether the call must now move on. Its tool call is the decision;
// no tool means carry on. The rules are the domain's (voice-agent.ts).

export type DeskDecision =
  | { readonly action: "end" }
  | { readonly action: "transfer"; readonly reason: string | null }
  | null;

/** Long enough for a slow reply, short enough that a hung one is dropped. */
const DESK_TIMEOUT_MS = 8_000;

const deskTools = Object.fromEntries(
  VOICE_AGENT_TOOLS.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(
        JSON.parse(JSON.stringify(definition.parameters)),
      ),
    }),
  ]),
);

export async function decideCallMove(
  turns: readonly VoiceAgentTurn[],
): Promise<DeskDecision> {
  const transcript = formatVoiceAgentTranscript(turns);
  if (!transcript) return null;
  const result = await generateText({
    abortSignal: AbortSignal.timeout(DESK_TIMEOUT_MS),
    maxOutputTokens: 200,
    messages: [{ content: transcript, role: "user" }],
    model: gateway(VOICE_AGENT_DESK_MODEL),
    providerOptions: { gateway: { tags: ["voice-agent", "mili-desk"] } },
    system: voiceAgentDeskInstructions(),
    toolChoice: "auto",
    tools: deskTools,
  });
  for (const call of result.toolCalls) {
    if (call.toolName === "end_call") return { action: "end" };
    if (call.toolName === "transfer_to_team") {
      const reason = (call.input as { reason?: unknown } | undefined)?.reason;
      return {
        action: "transfer",
        reason: typeof reason === "string" && reason.trim() ? reason : null,
      };
    }
  }
  return null;
}
