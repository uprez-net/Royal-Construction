import assert from "node:assert/strict";
import { test } from "vitest";

import { voiceCallerPreparer } from "@/lib/comms/voice-agent/caller";
import { TURN_QUIET_MS } from "@/lib/comms/voice-agent/session";
import {
  VOICE_AGENT_WRAP_UP_SECONDS,
  voiceLookupResultCue,
} from "@/lib/domain/comms/calls/voice-agent";
import {
  ASK_HERMES_TIMEOUT_MS,
  OWNER_CALL_WRAP_UP_CUE,
} from "@/lib/domain/comms/calls/voice-agent-owner-call";
import type { OwnerAssistantQuestion } from "@/lib/domain/ports/owner-assistant";

import { recordingDb } from "../architecture/domain-harness";
import { started } from "./voice-agent-harness";

// Mili's briefing call to the owner, through her session: the owner call's
// own opening and words, a desk that cannot transfer, and a question passed
// to Hermes with Hermes's longer wait.

const CLAIMS = {
  callControlId: "v3:abc",
  callId: "call-1",
  expiresAt: 0,
  maxSeconds: 270,
  provider: "telnyx" as const,
};

function ownerDb() {
  return recordingDb({
    "call.findUnique": {
      contactName: "Raj",
      direction: "OUTBOUND",
      ownerCall: {
        agenda: ["Framing finished on Tuesday"],
        category: "project_brief",
        context: "Smith St, Kellyville. Next inspection 2 Dec at 9:30.",
        eventAt: null,
        reference: "task-9",
        subject: "Smith St brief",
      },
      providerCallId: "v3:abc",
      staffTarget: "AGENT",
    },
  });
}

test("a briefing call starts Mili with the owner call's opening, a no-transfer desk and ask_hermes", async () => {
  const asked: OwnerAssistantQuestion[] = [];
  const recorder = ownerDb();
  const setup = await voiceCallerPreparer({
    assistant: {
      ask: async (question) => {
        asked.push(question);
        return "The inspection is at 9:30 on Tuesday.";
      },
    },
    db: recorder.db,
    disclosure: false,
  })(CLAIMS);
  assert.equal(setup.callerClass, "owner");
  assert.match(
    setup.greetingCue,
    /Hi Raj, it's Mili from Royal Constructions, calling with a project brief/,
  );
  assert.match(setup.instructions, /Smith St, Kellyville/);
  assert.deepEqual(setup.desk, { canAskAssistant: true, kind: "owner_call" });
  assert.deepEqual(
    setup.lookups.map((lookup) => lookup.name),
    ["ask_hermes"],
  );
  assert.ok(setup.lookup);
  const answer = await setup.lookup({
    name: "ask_hermes",
    question: "When's the inspection?",
  });
  assert.equal(answer, "The inspection is at 9:30 on Tuesday.");
  assert.equal(asked[0].reference, "task-9");
});

test("without Hermes connected, Mili has the briefing and nothing to look up", async () => {
  const setup = await voiceCallerPreparer({
    db: ownerDb().db,
    disclosure: false,
  })(CLAIMS);
  assert.deepEqual(setup.lookups, []);
  assert.equal(setup.lookup, null);
  assert.match(setup.instructions, /You cannot look anything up on this call/);
});

test("on the call: the desk is told it is an owner call, Hermes gets its longer wait, and the wrap-up is the owner call's", async () => {
  const setup = await voiceCallerPreparer({
    assistant: { ask: async () => "Dev and the certifier." },
    db: ownerDb().db,
    disclosure: false,
  })(CLAIMS);
  const h = await started(
    async () => ({
      action: "lookup",
      request: { name: "ask_hermes", question: "Who's at the inspection?" },
    }),
    async () => setup,
  );
  h.session.handleModelEvent({
    delta: "One moment, let me check that.",
    endMs: 100,
    startMs: 0,
    type: "session.output_transcript.delta",
  });
  // The wait for Hermes is set before it answers: the session's default
  // lookup timeout would cut Hermes off.
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.deepEqual(h.modes.at(-1), {
    canAskAssistant: true,
    kind: "owner_call",
  });
  assert.ok(h.timers.some((timer) => timer.ms === ASK_HERMES_TIMEOUT_MS));
  await h.tick();
  assert.deepEqual(h.modelOut.at(-1), {
    content: voiceLookupResultCue("Dev and the certifier."),
    delegation_id: null,
    type: "session.commentary.append",
  });

  h.fire((CLAIMS.maxSeconds - VOICE_AGENT_WRAP_UP_SECONDS) * 1000);
  assert.deepEqual(h.modelOut.at(-1), {
    content: OWNER_CALL_WRAP_UP_CUE,
    delegation_id: null,
    type: "session.instructions.append",
  });
});
