import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ASK_HERMES,
  ASK_HERMES_DEFINITION,
  HAND_TO_HERMES_DEFINITION,
  OWNER_CALL_HAND_FAILED_CUE,
  OWNER_CALL_HOLD_FAILED_CUE,
  OWNER_CALL_HOLD_LOST_CUE,
  OWNER_CALL_LOOKUP_FAILED_CUE,
  OWNER_CALL_SILENCE_GOODBYE_CUE,
  OWNER_CALL_WRAP_UP_CUE,
  ownerCallHandedCue,
  ownerCallHermesAnswerCue,
  voiceAgentOwnerCallInstructions,
  voiceAgentOwnerDeskInstructions,
} from "@/lib/domain/comms/calls/voice-agent-owner-call";

// The owner never hears the word "Hermes": every line Mili is given to say, or
// to repeat, calls the assistant "Agent Factory". Tool names stay (the model
// never says them aloud).
test("nothing Mili or her desk is told to say names Hermes", () => {
  const briefing = {
    agenda: ["One"],
    callId: "c",
    category: "other" as const,
    context: "ctx",
    eventAt: null,
    ownerName: "Raj",
    reference: null,
    subject: "s",
  };
  const text = [
    voiceAgentOwnerCallInstructions(briefing, {
      canAskAssistant: true,
      caller: null,
    }),
    voiceAgentOwnerCallInstructions(briefing, {
      canAskAssistant: false,
      caller: null,
    }),
    voiceAgentOwnerDeskInstructions({
      canAskAssistant: true,
      lookups: [ASK_HERMES],
    }),
    OWNER_CALL_HAND_FAILED_CUE,
    OWNER_CALL_HOLD_FAILED_CUE,
    OWNER_CALL_HOLD_LOST_CUE,
    OWNER_CALL_LOOKUP_FAILED_CUE,
    OWNER_CALL_SILENCE_GOODBYE_CUE,
    OWNER_CALL_WRAP_UP_CUE,
    ownerCallHandedCue({ callBack: true, timing: "in five minutes" }),
    ownerCallHandedCue({ callBack: false, timing: null }),
    ownerCallHermesAnswerCue("answer"),
    ASK_HERMES_DEFINITION.description,
    HAND_TO_HERMES_DEFINITION.description,
  ].join("\n");
  // Strip the tool names, which are identifiers, not speech.
  const spoken = text.replace(/\b(ask_hermes|hand_to_hermes)\b/g, "");
  assert.doesNotMatch(spoken, /hermes/i);
  assert.match(spoken, /Agent Factory/);
});

test("a briefing scheduled before the rename, or a hold answer, never says Hermes aloud", () => {
  const instructions = voiceAgentOwnerCallInstructions(
    {
      agenda: ["Hermes found the certifier's reply"],
      callId: "c",
      category: "other",
      context: "Hermes asked for this call because of the Smith St inspection.",
      eventAt: null,
      ownerName: "Raj",
      reference: null,
      subject: "Update from Hermes",
    },
    { canAskAssistant: true, caller: null },
  );
  const spoken = instructions.replace(/\b(ask_hermes|hand_to_hermes)\b/g, "");
  assert.doesNotMatch(spoken, /hermes/i);
  assert.match(spoken, /Agent Factory found the certifier's reply/);
  assert.doesNotMatch(
    ownerCallHermesAnswerCue("Hermes says the inspection is on Tuesday."),
    /hermes says/i,
  );
});
