import { gateway, generateText, jsonSchema, tool } from "ai";
import { z } from "zod";

import {
  formatVoiceAgentTranscript,
  VOICE_AGENT_TOOLS,
  voiceAgentDeskInstructions,
  type VoiceAgentTurn,
} from "@/lib/domain/comms/calls/voice-agent";
import {
  ASK_HERMES_QUESTION_MAX_CHARS,
  voiceAgentOwnerDeskInstructions,
} from "@/lib/domain/comms/calls/voice-agent-owner-call";
import type {
  VoiceLookupDefinition,
  VoiceLookupRequest,
} from "@/lib/domain/comms/callers/lookups";

import { VOICE_AGENT_DESK_MODEL } from "./settings";

// The call desk: the second model behind Mili.
//
// GPT-Live carries the conversation but cannot call tools, so after each
// thing Mili says (and whenever Live delegates) this asks a fast text model on
// AI Gateway whether the call must now move on — and, for a verified admin,
// whether she is waiting on a lookup. Its tool call is the decision; no tool
// means carry on. The rules are the domain's (voice-agent.ts, callers/).
//
// The lookup tools offered are exactly the ones the domain says this caller
// may run. The model's arguments are parsed here (shape only); the domain
// decides again whether the caller may run it, and what it returns.

export type DeskDecision =
  | { readonly action: "end" }
  | { readonly action: "transfer"; readonly reason: string | null }
  | { readonly action: "lookup"; readonly request: VoiceLookupRequest }
  | null;

/**
 * A briefing call Mili placed to the owner: nobody to transfer to, and the
 * desk can pass a question to Hermes when it is connected.
 */
export type DeskMode = {
  readonly kind: "owner_call";
  readonly canAskAssistant: boolean;
};

/** Long enough for a slow reply, short enough that a hung one is dropped. */
const DESK_TIMEOUT_MS = 8_000;

const words = z.string().trim().min(1).max(80);

/** The shape of each lookup's arguments, as the desk model sends them. */
const LOOKUP_INPUT = z.discriminatedUnion("name", [
  z.object({ name: z.literal("project_status"), project: words }),
  z.object({ name: z.literal("project_financials"), project: words }),
  z.object({ lead: words, name: z.literal("lead_summary") }),
  z.object({ name: z.literal("offer_status"), offer: words }),
  z.object({ name: z.literal("tradie_bookings"), tradie: words }),
  z.object({
    name: z.literal("bookings_between"),
    when: z.enum(["today", "tomorrow", "this_week", "next_week"]),
  }),
  z.object({ name: z.literal("pipeline_summary") }),
  z.object({
    name: z.literal("ask_hermes"),
    question: z.string().trim().min(1).max(ASK_HERMES_QUESTION_MAX_CHARS),
  }),
  z.object({
    call_back: z.boolean(),
    name: z.literal("hand_to_hermes"),
    request: z.string().trim().min(1).max(ASK_HERMES_QUESTION_MAX_CHARS),
    timing: z.string().trim().min(1).max(80).optional(),
  }),
]);

/** A desk tool call → a lookup request, or null when it is not one. */
export function parseLookupCall(
  toolName: string,
  input: unknown,
): VoiceLookupRequest | null {
  const args = input && typeof input === "object" ? input : {};
  const parsed = LOOKUP_INPUT.safeParse({ ...args, name: toolName });
  return parsed.success ? parsed.data : null;
}

function asTool(definition: {
  readonly description: string;
  readonly parameters: unknown;
}) {
  return tool({
    description: definition.description,
    inputSchema: jsonSchema<Record<string, unknown>>(
      JSON.parse(JSON.stringify(definition.parameters)),
    ),
  });
}

const callTools = Object.fromEntries(
  VOICE_AGENT_TOOLS.map((definition) => [definition.name, asTool(definition)]),
);

/** On a briefing call the desk can only end it: there is nobody to transfer to. */
const ownerCallTools = Object.fromEntries(
  VOICE_AGENT_TOOLS.filter((definition) => definition.name === "end_call").map(
    (definition) => [definition.name, asTool(definition)],
  ),
);

function deskSystem(
  lookups: readonly VoiceLookupDefinition[],
  mode: DeskMode | undefined,
): string {
  const names = lookups.map((lookup) => lookup.name);
  return mode?.kind === "owner_call"
    ? voiceAgentOwnerDeskInstructions({
        canAskAssistant: mode.canAskAssistant,
        lookups: names,
      })
    : voiceAgentDeskInstructions({ lookups: names });
}

export async function decideCallMove(
  turns: readonly VoiceAgentTurn[],
  lookups: readonly VoiceLookupDefinition[] = [],
  mode?: DeskMode,
): Promise<DeskDecision> {
  const transcript = formatVoiceAgentTranscript(turns);
  if (!transcript) return null;
  const offered = new Set<string>(lookups.map((lookup) => lookup.name));
  const result = await generateText({
    abortSignal: AbortSignal.timeout(DESK_TIMEOUT_MS),
    maxOutputTokens: 200,
    messages: [{ content: transcript, role: "user" }],
    model: gateway(VOICE_AGENT_DESK_MODEL),
    providerOptions: { gateway: { tags: ["voice-agent", "mili-desk"] } },
    system: deskSystem(lookups, mode),
    toolChoice: "auto",
    tools: {
      ...(mode?.kind === "owner_call" ? ownerCallTools : callTools),
      ...Object.fromEntries(
        lookups.map((lookup) => [lookup.name, asTool(lookup)]),
      ),
    },
  });
  // Moving the call on wins over a lookup in the same reply.
  for (const call of result.toolCalls) {
    if (call.toolName === "end_call") return { action: "end" };
    if (call.toolName === "transfer_to_team" && mode?.kind !== "owner_call") {
      const reason = (call.input as { reason?: unknown } | undefined)?.reason;
      return {
        action: "transfer",
        reason: typeof reason === "string" && reason.trim() ? reason : null,
      };
    }
  }
  for (const call of result.toolCalls) {
    if (!offered.has(call.toolName)) continue;
    const request = parseLookupCall(call.toolName, call.input);
    if (request) return { action: "lookup", request };
  }
  return null;
}
