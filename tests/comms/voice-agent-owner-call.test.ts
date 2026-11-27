import assert from "node:assert/strict";
import { test } from "vitest";

import { voiceCallerPreparer } from "@/lib/comms/voice-agent/caller";
import { TURN_QUIET_MS } from "@/lib/comms/voice-agent/session";
import {
  OWNER_CALL_SILENCE_POLICY,
  VOICE_AGENT_WRAP_UP_SECONDS,
} from "@/lib/domain/comms/calls/voice-agent";
import {
  ASK_HERMES_TIMEOUT_MS,
  OWNER_CALL_HAND_FAILED_CUE,
  OWNER_CALL_HOLD_FAILED_CUE,
  OWNER_CALL_HOLD_LOST_CUE,
  OWNER_CALL_WRAP_UP_CUE,
  ownerCallHandedCue,
  ownerCallHermesAnswerCue,
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

function ownerDb(extra: Record<string, unknown> = {}) {
  return recordingDb({
    "ownerCallHandoff.findUnique": { id: "h-1", status: "OPEN" },
    "ownerCallHandoffRequest.count": 0,
    "ownerCallHandoffRequest.findUnique": null,
    ...extra,
    "call.findUnique": {
      contactName: "Raj",
      direction: "OUTBOUND",
      ownerCall: {
        id: "oc-1",
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

test("a briefing call starts Mili with the owner call's opening, a no-transfer desk, ask_hermes and hand_to_hermes", async () => {
  const asked: OwnerAssistantQuestion[] = [];
  const recorder = ownerDb();
  const setup = await voiceCallerPreparer({
    assistant: {
      ask: async (question) => {
        asked.push(question);
        return "The inspection is at 9:30 on Tuesday.";
      },
      handOff: async () => "",
    },
    db: recorder.transactionalDb,
    disclosure: false,
  })(CLAIMS);
  assert.equal(setup.callerClass, "owner");
  assert.match(
    setup.greetingCue,
    /Hi Raj, it's Mili from Royal Constructions, calling with a project brief/,
  );
  assert.match(setup.instructions, /Smith St, Kellyville/);
  assert.deepEqual(setup.desk, { canAskAssistant: true, kind: "owner_call" });
  assert.equal(setup.silence, OWNER_CALL_SILENCE_POLICY);
  assert.deepEqual(
    setup.lookups.map((lookup) => lookup.name),
    ["ask_hermes", "hand_to_hermes"],
  );
  // She offers the owner the choice before asking Hermes anything.
  assert.match(
    setup.instructions,
    /Would you like to hold, or shall I have Agent Factory call you back/,
  );
  assert.ok(setup.lookup);
  const answer = await setup.lookup({
    name: "ask_hermes",
    question: "When's the inspection?",
  });
  assert.deepEqual(answer, {
    answered: true,
    cue: ownerCallHermesAnswerCue("The inspection is at 9:30 on Tuesday."),
    text: "The inspection is at 9:30 on Tuesday.",
  });
  assert.equal(asked[0].reference, "task-9");
});

test("without Hermes connected, Mili has the briefing and can only note a call back", async () => {
  const setup = await voiceCallerPreparer({
    db: ownerDb().transactionalDb,
    disclosure: false,
  })(CLAIMS);
  assert.deepEqual(
    setup.lookups.map((lookup) => lookup.name),
    ["hand_to_hermes"],
  );
  assert.equal(setup.hold, null);
  assert.match(setup.instructions, /you cannot check it on this call/);
  assert.match(setup.instructions, /Never ask them to hold/);
});

test("on the call: the desk is told it is an owner call, Hermes gets its longer wait, and the wrap-up is the owner call's", async () => {
  const setup = await voiceCallerPreparer({
    assistant: {
      ask: async () => "Dev and the certifier.",
      handOff: async () => "",
    },
    db: ownerDb().transactionalDb,
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
    content: ownerCallHermesAnswerCue("Dev and the certifier."),
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

test("holding: hold music comes with ask_hermes; Hermes failing becomes a call back, noted as one", async () => {
  const recorder = ownerDb();
  const setup = await voiceCallerPreparer({
    assistant: {
      ask: async () => {
        throw new Error("down");
      },
      handOff: async () => "",
    },
    db: recorder.transactionalDb,
    disclosure: false,
    holdMusic: async () => new Uint8Array(1_600),
  })(CLAIMS);
  assert.deepEqual(setup.hold?.lookups, ["ask_hermes"]);
  const reply = await setup.lookup!({
    name: "ask_hermes",
    question: "Who else is coming?",
  });
  assert.deepEqual(reply, {
    answered: true,
    cue: OWNER_CALL_HOLD_FAILED_CUE,
    failure: "DomainSideEffectError",
    text: "noted for a call back (handoff h-1)",
  });
  const noted = recorder.calls.find(
    (c) => c.operation === "ownerCallHandoffRequest.create",
  )?.args as { data: Record<string, unknown> };
  assert.equal(noted.data.request, "Who else is coming?");
  assert.equal(noted.data.callBack, true);
  assert.equal(noted.data.source, "hold_failed");
});

test("holding: if the call back can't be noted either, Mili promises nothing", async () => {
  const setup = await voiceCallerPreparer({
    assistant: {
      ask: async () => {
        throw new Error("down");
      },
      handOff: async () => "",
    },
    db: ownerDb({
      "ownerCallHandoffRequest.create": () => {
        throw new Error("database down");
      },
    }).transactionalDb,
    disclosure: false,
  })(CLAIMS);
  const reply = await setup.lookup!({
    name: "ask_hermes",
    question: "Who else is coming?",
  });
  assert.equal((reply as { cue: string }).cue, OWNER_CALL_HOLD_LOST_CUE);
  assert.equal((reply as { answered: boolean }).answered, false);
});

test("a call back the owner asks for is noted for Hermes, and Mili confirms only that", async () => {
  const recorder = ownerDb();
  const setup = await voiceCallerPreparer({
    db: recorder.transactionalDb,
    disclosure: false,
  })(CLAIMS);
  const reply = await setup.lookup!({
    call_back: true,
    name: "hand_to_hermes",
    request: "Find the past two building bookings and call back with them.",
  });
  assert.deepEqual(reply, {
    answered: true,
    cue: ownerCallHandedCue({ callBack: true, timing: null }),
    text: "noted (handoff h-1)",
  });
  assert.doesNotMatch(
    ownerCallHandedCue({ callBack: true, timing: null }),
    /at the time they gave/,
  );

  const broken = await voiceCallerPreparer({
    db: ownerDb({
      "ownerCallHandoffRequest.create": () => {
        throw new Error("database down");
      },
    }).transactionalDb,
    disclosure: false,
  })(CLAIMS);
  const failed = await broken.lookup!({
    call_back: false,
    name: "hand_to_hermes",
    request: "Book the plumber",
  });
  assert.equal((failed as { cue: string }).cue, OWNER_CALL_HAND_FAILED_CUE);
  assert.equal((failed as { answered: boolean }).answered, false);
});
