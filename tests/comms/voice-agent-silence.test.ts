import assert from "node:assert/strict";
import { test } from "vitest";

import {
  VOICE_AGENT_SILENCE_FOLLOW_UPS,
  VOICE_AGENT_SILENCE_SECONDS,
  voiceSilenceCallerSpoke,
  voiceSilenceCheck,
  voiceSilenceStart,
  type VoiceSilenceState,
} from "@/lib/domain/comms/calls/voice-agent";

// The domain's silence policy: when Mili follows up on a quiet caller, when
// she says goodbye, and what calls either off. Pure, so driven by hand.

const SILENCE = VOICE_AGENT_SILENCE_SECONDS * 1000;
const T0 = 1_000_000;

const quiet = (now: number, agentSpeechEndsAt = 0) => ({
  agentSpeechEndsAt,
  busy: false,
  now,
});

test("follow-ups after each silence, then one goodbye, then nothing", () => {
  let state = voiceSilenceStart(T0);
  let now = T0;
  for (let i = 1; i <= VOICE_AGENT_SILENCE_FOLLOW_UPS; i += 1) {
    now += SILENCE;
    const step = voiceSilenceCheck(state, quiet(now));
    assert.deepEqual(step.action, { kind: "follow_up", ms: SILENCE });
    assert.equal(step.state.followUps, i);
    state = step.state;
  }
  now += SILENCE;
  const goodbye = voiceSilenceCheck(state, quiet(now));
  assert.deepEqual(goodbye.action, { kind: "goodbye" });
  assert.equal(goodbye.state.saidGoodbye, true);
  assert.deepEqual(
    voiceSilenceCheck(goodbye.state, quiet(now + SILENCE)).action,
    { kind: "none" },
    "the goodbye is said once",
  );
});

test("silence counts from the latest of her speech, the caller and the last cue", () => {
  const state: VoiceSilenceState = {
    ...voiceSilenceStart(T0),
    callerSpokeAt: T0 + 2_000,
  };
  assert.deepEqual(voiceSilenceCheck(state, quiet(T0 + SILENCE)).action, {
    kind: "wait",
    ms: 2_000,
  });
  // Her speech still playing pushes it further.
  assert.deepEqual(
    voiceSilenceCheck(state, quiet(T0 + SILENCE, T0 + 5_000)).action,
    { kind: "wait", ms: 5_000 },
  );
});

test("nothing while the desk is busy", () => {
  const state = voiceSilenceStart(T0);
  const step = voiceSilenceCheck(state, {
    agentSpeechEndsAt: 0,
    busy: true,
    now: T0 + 10 * SILENCE,
  });
  assert.deepEqual(step.action, { kind: "wait", ms: SILENCE });
  assert.equal(step.state, state);
});

test("the caller speaking resets the follow-ups and calls off a goodbye", () => {
  const ending: VoiceSilenceState = {
    callerSpokeAt: 0,
    cuedAt: T0,
    followUps: VOICE_AGENT_SILENCE_FOLLOW_UPS,
    saidGoodbye: true,
  };
  const spoke = voiceSilenceCallerSpoke(ending, T0 + 1_000);
  assert.deepEqual(spoke, {
    callerSpokeAt: T0 + 1_000,
    cuedAt: T0,
    followUps: 0,
    saidGoodbye: false,
  });
  assert.deepEqual(
    voiceSilenceCheck(spoke, quiet(T0 + 1_000 + SILENCE)).action,
    { kind: "follow_up", ms: SILENCE },
    "the next silence is a follow-up again, not a goodbye",
  );
});
