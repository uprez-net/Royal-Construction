import assert from "node:assert/strict";
import { test } from "vitest";

import {
  CALLER_SILENCE_MS,
  isSpeech,
  SILENCE_GOODBYE_TIMEOUT_MS,
  START_TIMEOUT_MS,
  TURN_QUIET_MS,
} from "@/lib/comms/voice-agent/session";
import {
  formatVoiceAgentTranscript,
  VOICE_AGENT_TRANSCRIPT_MAX_CHARS,
  VOICE_AGENT_GREETING,
  VOICE_AGENT_GREETING_CUE,
  VOICE_AGENT_MAX_SECONDS,
  VOICE_AGENT_SILENCE_FOLLOW_UP_CUE,
  VOICE_AGENT_SILENCE_FOLLOW_UPS,
  VOICE_AGENT_SILENCE_GOODBYE_CUE,
  VOICE_AGENT_WRAP_UP_INSTRUCTION,
} from "@/lib/domain/comms/calls/voice-agent";

import {
  token,
  harness,
  telnyxStart,
  SPEECH,
  callerMedia,
  started,
} from "./voice-agent-harness";

// One conversation with Mili driven end to end through scripted sockets and
// timers, with the call desk deciding when it ends.

// ── Session ──────────────────────────────────────────────────────────

test("a stream without a valid token never reaches the model", async () => {
  for (const [urlToken, start] of [
    [undefined, telnyxStart()],
    [token("telnyx", "v3:other"), telnyxStart()],
    [token("twilio", "v3:abc"), telnyxStart()],
  ] as const) {
    const h = harness("telnyx", urlToken);
    h.session.handleCarrierText(start);
    await h.session.done;
    assert.equal(h.state.opened, 0);
    assert.equal(h.state.carrierClosed, true);
    assert.deepEqual(h.reports, []);
  }
  const silent = harness("telnyx", token("telnyx", "v3:abc"));
  silent.fire(START_TIMEOUT_MS);
  await silent.session.done;
  assert.equal(silent.state.carrierClosed, true);
});

test("Live starts as Mili, in phone μ-law, with client delegation", async () => {
  const h = harness("telnyx", token("telnyx", "v3:abc"));
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  assert.equal(h.state.opened, 1);
  const start = h.modelOut[0];
  assert.equal(start.type, "session.start");
  if (start.type !== "session.start") return;
  assert.equal(start.session.model, "openai/gpt-live-1.1");
  assert.deepEqual(start.session.audio, {
    format: { rate: 8000, type: "audio/pcmu" },
    output: { voice: "marin" },
  });
  assert.deepEqual(start.session.delegation, { type: "client" });
  assert.equal(start.session.store, false);
  assert.ok(
    start.session.instructions.includes(VOICE_AGENT_GREETING),
    "she opens the call herself, in the agreed words",
  );
});

test("once Live has started Mili is cued to greet first, once, before the caller says anything", async () => {
  const h = await started();
  const cue = {
    content: VOICE_AGENT_GREETING_CUE,
    delegation_id: null,
    type: "session.commentary.append",
  } as const;
  // Straight after session.start: she does not wait for caller audio.
  assert.equal(h.modelOut.length, 2);
  assert.deepEqual(h.modelOut[1], cue);
  assert.ok(VOICE_AGENT_GREETING_CUE.includes(VOICE_AGENT_GREETING));
  // A repeated session.started does not make her greet twice.
  h.session.handleModelEvent({ type: "session.started" });
  assert.equal(h.modelOut.filter((e) => e.type === cue.type).length, 1);
});

test("one conversation: audio passes through, transcripts kept, the desk ends it after her goodbye", async () => {
  let goodbyeSaid = false;
  const h = await started(async () => (goodbyeSaid ? { action: "end" } : null));

  // Caller audio goes to Live untouched: both sides speak 8 kHz μ-law.
  h.session.handleCarrierText(callerMedia);
  assert.deepEqual(h.modelOut.at(-1), {
    audio: Buffer.alloc(160, 0xff).toString("base64"),
    type: "session.input_audio.append",
  });

  // 40 ms of her audio → two 20 ms phone frames.
  h.session.handleModelEvent({
    delta: Buffer.alloc(320, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  const frames = h.carrierOut.map((text) => JSON.parse(text));
  assert.equal(frames.length, 2);
  assert.equal(Buffer.from(frames[0].media.payload, "base64").length, 160);

  // Transcript deltas carry session time, as Live sends them.
  for (const [delta, at] of [
    [" Hi,", 1000],
    [" you're speaking with Mili.", 1200],
  ] as const) {
    h.session.handleModelEvent({
      delta,
      endMs: at + 200,
      startMs: at,
      type: "session.output_transcript.delta",
    });
  }
  for (const [delta, at] of [
    [" I'd like", 4000],
    [" a knockdown rebuild.", 4200],
  ] as const) {
    h.session.handleModelEvent({
      delta,
      endMs: at + 200,
      startMs: at,
      type: "session.input_transcript.delta",
    });
  }

  // Her turn ends (no audio for a moment): the desk is asked, says carry on.
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.equal(h.asked.length, 1);
  assert.deepEqual(h.reports, []);

  // She says goodbye; the desk now ends the call, once her words have played.
  goodbyeSaid = true;
  h.session.handleModelEvent({
    delta: Buffer.alloc(160, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.session.handleModelEvent({
    delta: " Goodbye.",
    endMs: 9200,
    startMs: 9000,
    type: "session.output_transcript.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.deepEqual(h.reports, [], "waits for her goodbye to finish playing");
  h.fireLast();
  await h.session.done;
  assert.deepEqual(h.reports, [
    {
      callControlId: "v3:abc",
      callId: "call-1",
      outcome: "completed",
      provider: "telnyx",
      turns: [
        { speaker: "agent", text: "Hi, you're speaking with Mili." },
        { speaker: "caller", text: "I'd like a knockdown rebuild." },
        { speaker: "agent", text: "Goodbye." },
      ],
    },
  ]);
  assert.deepEqual(h.modelOut.at(-1), { type: "session.close" });
  assert.equal(h.state.modelClosed, true);
  assert.equal(h.state.carrierClosed, true);
});

test("a Live delegation asks the desk at once and tells Mili what it did", async () => {
  const h = await started(async () => ({
    action: "transfer",
    reason: "asked for a person",
  }));
  h.session.handleModelEvent({
    delegationId: "item_1",
    type: "session.delegation.created",
  });
  await h.tick();
  assert.deepEqual(h.modelOut.at(-1), {
    content: "The call desk is putting the caller through to the team now.",
    delegation_id: "item_1",
    type: "session.thinking.append",
  });
  h.fireLast();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "transfer");
});

test("audio still arriving after the desk decides is played before the line moves on", async () => {
  const h = await started(async () => ({ action: "end" }));
  h.session.handleModelEvent({
    delegationId: "item_1",
    type: "session.delegation.created",
  });
  await h.tick();
  // A second more of her goodbye arrives after the decision.
  h.session.handleModelEvent({
    delta: Buffer.alloc(8_000, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.fireLast();
  assert.equal(h.reports.length, 0, "a second of audio is still playing");
  h.advance(2_000);
  h.fireLast();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "completed");
});

test("a desk that fails never ends the call by itself", async () => {
  const h = await started(async () => {
    throw new Error("gateway down");
  });
  h.session.handleModelEvent({
    delta: Buffer.alloc(160).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.deepEqual(h.reports, []);
  h.session.handleCarrierText(callerMedia);
  assert.equal(h.modelOut.at(-1)?.type, "session.input_audio.append");
});

test("her line hiss is not speech; her voice is", () => {
  assert.equal(isSpeech(Buffer.alloc(160, 0xff)), false, "μ-law silence");
  assert.equal(isSpeech(Buffer.alloc(160, 0x7f)), false, "the other zero");
  assert.equal(isSpeech(Buffer.alloc(160, SPEECH)), true);
  assert.equal(isSpeech(Buffer.alloc(0)), false);
});

test("GPT-Live's continuous silence never ends her turn or asks the desk", async () => {
  const h = await started(async () => ({ action: "end" }));
  // Live streams audio the whole time; silence restarts nothing.
  for (let i = 0; i < 5; i += 1) {
    h.session.handleModelEvent({
      delta: Buffer.alloc(160, 0xff).toString("base64"),
      type: "session.output_audio.delta",
    });
  }
  assert.equal(
    h.timers.filter((t) => t.live && t.ms === TURN_QUIET_MS).length,
    0,
  );
  assert.equal(h.asked.length, 0);
});

test("overlapping speakers join up by time, not by who spoke last", async () => {
  const h = await started();
  const say = (speaker: "caller" | "agent", delta: string, startMs: number) =>
    h.session.handleModelEvent({
      delta,
      endMs: startMs + 200,
      startMs,
      type:
        speaker === "caller"
          ? "session.input_transcript.delta"
          : "session.output_transcript.delta",
    });
  // As captured from a live session: she backchannels while the caller talks.
  say("agent", " Hi, you're speaking", 1000);
  say("agent", " with Mili.", 1200);
  say("caller", " My name", 3000);
  say("agent", " Okay.", 3100);
  say("caller", " is Sam,", 3200);
  say("caller", " building in Oran Park.", 3400);
  say("agent", " Thanks, Sam.", 6000);
  assert.deepEqual(h.session.turns, [
    { speaker: "agent", text: "Hi, you're speaking with Mili." },
    { speaker: "caller", text: "My name is Sam, building in Oran Park." },
    { speaker: "agent", text: "Okay." },
    { speaker: "agent", text: "Thanks, Sam." },
  ]);
});

test("GPT-Live failing to start sends the caller to a person", async () => {
  const h = harness("telnyx", token("telnyx", "v3:abc"));
  h.session.handleCarrierText(telnyxStart());
  await h.tick();
  // Caller audio before the session is ready is dropped.
  h.session.handleCarrierText(callerMedia);
  assert.equal(h.modelOut.length, 1);
  h.session.handleModelEvent({
    code: "invalid_model",
    message: "nope",
    type: "error",
  });
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "failed");
});

test("GPT-Live dropping mid-call hands back", async () => {
  const h = await started();
  h.session.handleModelClosed();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "failed");
});

test("near the time limit Mili is asked to wrap up; at it the call ends", async () => {
  const h = await started();
  h.fire((VOICE_AGENT_MAX_SECONDS - 45) * 1000);
  assert.deepEqual(h.modelOut.at(-1), {
    content: VOICE_AGENT_WRAP_UP_INSTRUCTION,
    delegation_id: null,
    type: "session.instructions.append",
  });
  h.fire(VOICE_AGENT_MAX_SECONDS * 1000);
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "completed");
});

test("the caller hanging up ends the session once, with what was said", async () => {
  const h = harness("twilio");
  h.session.handleCarrierText(
    JSON.stringify({
      event: "start",
      start: {
        callSid: "CA1",
        customParameters: { token: token("twilio", "CA1") },
        streamSid: "MZ1",
      },
    }),
  );
  await h.tick();
  h.session.handleModelEvent({ type: "session.started" });
  h.session.handleCarrierText(JSON.stringify({ event: "stop" }));
  h.session.handleCarrierClosed();
  await h.session.done;
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].provider, "twilio");
});

test("the transcript is one line per turn, capped", () => {
  assert.equal(
    formatVoiceAgentTranscript([
      { speaker: "agent", text: " Hi  there " },
      { speaker: "caller", text: "" },
      { speaker: "caller", text: "Hello" },
    ]),
    "Mili: Hi there\nCaller: Hello",
  );
  assert.equal(formatVoiceAgentTranscript([]), null);
  // Sized for a 15-minute owner call, not just a 270 s inbound one.
  const long = formatVoiceAgentTranscript([
    {
      speaker: "caller",
      text: "x".repeat(VOICE_AGENT_TRANSCRIPT_MAX_CHARS + 10_000),
    },
  ]);
  assert.ok(long && long.length <= VOICE_AGENT_TRANSCRIPT_MAX_CHARS);
});

// ── A silent caller ──────────────────────────────────────────────────

const commentary = (h: Awaited<ReturnType<typeof started>>, content: string) =>
  h.modelOut.filter(
    (e) => e.type === "session.commentary.append" && e.content === content,
  ).length;

/** Mili has said her greeting: silence is counted from after it. */
function greeted(h: Awaited<ReturnType<typeof started>>) {
  h.session.handleModelEvent({
    delta: Buffer.alloc(160, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.advance(100);
}

test("a silent caller is followed up, then told the team will get back to them, and the call ends", async () => {
  const h = await started();
  greeted(h);
  for (let i = 1; i <= VOICE_AGENT_SILENCE_FOLLOW_UPS; i += 1) {
    h.advance(CALLER_SILENCE_MS);
    h.fire(CALLER_SILENCE_MS);
    assert.equal(commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE), i);
  }
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_GOODBYE_CUE), 0);
  h.advance(CALLER_SILENCE_MS);
  h.fire(CALLER_SILENCE_MS);
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_GOODBYE_CUE), 1);
  assert.ok(/recorded/.test(VOICE_AGENT_SILENCE_GOODBYE_CUE));
  assert.ok(/team will get back/.test(VOICE_AGENT_SILENCE_GOODBYE_CUE));

  // She says it; once it has played the call ends, without asking the desk.
  const asked = h.asked.length;
  h.session.handleModelEvent({
    delta: Buffer.alloc(160, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.equal(h.asked.length, asked);
  assert.equal(h.reports.length, 0, "waits for her goodbye to finish playing");
  h.fireLast();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "completed");
});

test("the caller speaking puts the silence back to the start, follow-ups included", async () => {
  const h = await started();
  greeted(h);
  h.advance(CALLER_SILENCE_MS);
  h.fire(CALLER_SILENCE_MS);
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE), 1);

  // Five seconds later the caller answers.
  h.advance(5_000);
  h.session.handleModelEvent({
    delta: " Sorry, I'm here.",
    endMs: null,
    startMs: null,
    type: "session.input_transcript.delta",
  });
  h.advance(CALLER_SILENCE_MS - 5_000);
  h.fire(CALLER_SILENCE_MS);
  assert.equal(
    commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE),
    1,
    "only three seconds have been quiet",
  );
  for (let i = 0; i < VOICE_AGENT_SILENCE_FOLLOW_UPS; i += 1) {
    h.advance(CALLER_SILENCE_MS);
    h.fireLast();
  }
  assert.equal(
    commentary(h, VOICE_AGENT_SILENCE_GOODBYE_CUE),
    0,
    "the follow-ups start again after the caller spoke",
  );
  assert.equal(
    commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE),
    1 + VOICE_AGENT_SILENCE_FOLLOW_UPS,
  );
});

test("caller audio loud enough to be speech counts as the caller talking", async () => {
  const h = await started();
  h.advance(CALLER_SILENCE_MS - 1_000);
  h.session.handleCarrierText(
    JSON.stringify({
      event: "media",
      media: {
        payload: Buffer.alloc(160, SPEECH).toString("base64"),
        track: "inbound",
      },
    }),
  );
  h.advance(1_000);
  h.fire(CALLER_SILENCE_MS);
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE), 0);
});

test("no follow-up while Mili is still talking", async () => {
  const h = await started();
  // Ten seconds of her speech queued at the carrier.
  h.session.handleModelEvent({
    delta: Buffer.alloc(80_000, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.advance(CALLER_SILENCE_MS);
  h.fire(CALLER_SILENCE_MS);
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE), 0);
});

test("a silent caller's call still ends if Mili never says goodbye", async () => {
  const h = await started();
  greeted(h);
  for (let i = 0; i <= VOICE_AGENT_SILENCE_FOLLOW_UPS; i += 1) {
    h.advance(CALLER_SILENCE_MS);
    h.fire(CALLER_SILENCE_MS);
  }
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_GOODBYE_CUE), 1);
  h.advance(SILENCE_GOODBYE_TIMEOUT_MS);
  h.fire(SILENCE_GOODBYE_TIMEOUT_MS);
  h.fireLast();
  await h.session.done;
  assert.equal(h.reports[0]?.outcome, "completed");
});

test("a caller who answers the goodbye is not hung up on", async () => {
  const h = await started();
  greeted(h);
  for (let i = 0; i <= VOICE_AGENT_SILENCE_FOLLOW_UPS; i += 1) {
    h.advance(CALLER_SILENCE_MS);
    h.fire(CALLER_SILENCE_MS);
  }
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_GOODBYE_CUE), 1);

  // Before she has said it, the caller speaks up.
  h.advance(500);
  h.session.handleModelEvent({
    delta: " Wait, I'm still here.",
    endMs: null,
    startMs: null,
    type: "session.input_transcript.delta",
  });
  // Her reply ending asks the desk (which carries on), not a hang-up.
  h.session.handleModelEvent({
    delta: Buffer.alloc(160, SPEECH).toString("base64"),
    type: "session.output_audio.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.equal(h.asked.length, 1);
  // The goodbye's 15-second fallback is gone.
  h.advance(SILENCE_GOODBYE_TIMEOUT_MS);
  h.fire(SILENCE_GOODBYE_TIMEOUT_MS);
  await h.tick();
  assert.deepEqual(h.reports, []);
  assert.equal(h.state.carrierClosed, false);
  // Silence is watched again, starting from follow-ups.
  h.fire(CALLER_SILENCE_MS);
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE), 3);
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_GOODBYE_CUE), 1);
});

test("silence is not counted before Mili has said a word: a slow start gets no follow-up", async () => {
  const h = await started();
  h.advance(CALLER_SILENCE_MS * 3);
  h.fire(CALLER_SILENCE_MS);
  assert.equal(commentary(h, VOICE_AGENT_SILENCE_FOLLOW_UP_CUE), 0);
});
