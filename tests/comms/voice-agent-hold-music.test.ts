import assert from "node:assert/strict";
import { test } from "vitest";

import {
  HOLD_LEAD_MS,
  TURN_QUIET_MS,
  type VoiceCallerSetup,
  type VoiceLookupReply,
} from "@/lib/comms/voice-agent/session";
import {
  holdMusicLoader,
  loadHoldMusic,
} from "@/lib/comms/voice-agent/hold-music";
import { VOICE_LOOKUPS } from "@/lib/domain/comms/callers/lookups";
import {
  ASK_HERMES_DEFINITION,
  HAND_TO_HERMES_DEFINITION,
} from "@/lib/domain/comms/calls/voice-agent-owner-call";

import { SPEECH, started } from "./voice-agent-harness";

// The owner chose to hold for Hermes: music plays instead of silence, only
// once Mili's "one moment" has played, never queued behind or over her, and
// it stops — dropped at the carrier — the moment the answer is back.

const MUSIC = Buffer.alloc(8_000, 0x55);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function holdSetup(
  lookup: VoiceCallerSetup["lookup"],
  overrides: Partial<VoiceCallerSetup> = {},
): VoiceCallerSetup {
  return {
    callerClass: "owner",
    desk: { canAskAssistant: true, kind: "owner_call" },
    greetingCue: "greet",
    hold: { audio: MUSIC, lookups: ["ask_hermes"] },
    instructions: "owner call",
    lookup,
    lookups: [ASK_HERMES_DEFINITION, HAND_TO_HERMES_DEFINITION],
    ...overrides,
  };
}

const media = (frames: readonly string[]) =>
  frames.filter((frame) => JSON.parse(frame).event === "media");
const clears = (frames: readonly string[]) =>
  frames.filter((frame) => JSON.parse(frame).event === "clear");

const audio = (byte: number) => ({
  delta: Buffer.alloc(160, byte).toString("base64"),
  type: "session.output_audio.delta" as const,
});

async function holding(answer: Promise<string | VoiceLookupReply>) {
  const h = await started(
    async () => ({
      action: "lookup",
      request: { name: "ask_hermes", question: "Who else is coming?" },
    }),
    async () => holdSetup(() => answer),
  );
  h.session.handleModelEvent({
    delta: "Sure, one moment.",
    endMs: 100,
    startMs: 0,
    type: "session.output_transcript.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  return h;
}

test("holding: music plays while Hermes is asked, her silence is not sent, and it stops with a clear when the answer is back", async () => {
  const answer = deferred<VoiceLookupReply>();
  const h = await holding(answer.promise);

  const music = media(h.carrierOut);
  assert.ok(music.length > 0, "the owner hears music, not silence");
  assert.equal(
    JSON.parse(music[0]).media.payload,
    MUSIC.subarray(0, 160).toString("base64"),
    "the loop starts at its beginning",
  );

  // GPT-Live keeps sending silence: on hold it is dropped, or the carrier
  // would play it in place of the music.
  const before = h.carrierOut.length;
  h.session.handleModelEvent(audio(0xff));
  assert.equal(h.carrierOut.length, before);

  // Topped up as it plays.
  h.advance(1_000);
  h.fire(200);
  assert.ok(media(h.carrierOut).length > music.length);

  answer.resolve({ answered: true, cue: "Hermes says: Dev.", text: "Dev." });
  await h.tick();
  await h.tick();
  assert.equal(clears(h.carrierOut).length, 1, "the queued music is dropped");
  assert.deepEqual(h.modelOut.at(-1), {
    content: "Hermes says: Dev.",
    delegation_id: null,
    type: "session.commentary.append",
  });

  // Off hold, her audio goes through again, and no more music is added.
  const after = h.carrierOut.length;
  h.session.handleModelEvent(audio(0xff));
  assert.equal(h.carrierOut.length, after + 1);
  h.advance(1_000);
  h.fire(200);
  assert.equal(h.carrierOut.length, after + 1);
});

test("holding: if Mili speaks, the music queued ahead of her is dropped and her words play at once", async () => {
  const h = await holding(new Promise(() => {}));
  assert.ok(media(h.carrierOut).length > 0);
  h.session.handleModelEvent(audio(SPEECH));
  assert.equal(clears(h.carrierOut).length, 1);
  assert.equal(
    JSON.parse(h.carrierOut.at(-1) ?? "{}").media.payload,
    Buffer.alloc(160, SPEECH).toString("base64"),
  );
  // The music waits for her to finish before picking up again.
  const count = h.carrierOut.length;
  h.fire(200);
  assert.equal(h.carrierOut.length, count);
  h.advance(20 + HOLD_LEAD_MS);
  h.fire(200);
  assert.ok(h.carrierOut.length > count);
});

test("holding: the pauses inside what she says go through with her words, and the music waits", async () => {
  const h = await holding(new Promise(() => {}));
  h.session.handleModelEvent(audio(SPEECH));
  const afterWord = h.carrierOut.length;
  // A pause between two words: part of what she is saying.
  h.session.handleModelEvent(audio(0xff));
  h.session.handleModelEvent(audio(SPEECH));
  assert.equal(h.carrierOut.length, afterWord + 2);
  assert.equal(clears(h.carrierOut).length, 1, "no music came between them");
  // Well after her last word, background silence is dropped again.
  h.advance(5_000);
  const quiet = h.carrierOut.length;
  h.session.handleModelEvent(audio(0xff));
  assert.equal(h.carrierOut.length, quiet);
});

test("a lookup nobody holds for (Royal's records) plays no music", async () => {
  const records = VOICE_LOOKUPS.find((l) => l.name === "pipeline_summary");
  assert.ok(records);
  const h = await started(
    async () => ({ action: "lookup", request: { name: "pipeline_summary" } }),
    async () =>
      holdSetup(async () => "Three live leads.", {
        lookups: [records, ASK_HERMES_DEFINITION],
      }),
  );
  h.session.handleModelEvent({
    delta: "One moment, let me check that.",
    endMs: 100,
    startMs: 0,
    type: "session.output_transcript.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  await h.tick();
  assert.equal(media(h.carrierOut).length, 0);
  assert.equal(clears(h.carrierOut).length, 0);
});

test("the hold music file ships with the repo, as 8 kHz μ-law audio of a sensible length", async () => {
  const music = await loadHoldMusic();
  assert.ok(music, "assets/voice-agent/hold-music.ulaw is readable");
  // 8,000 bytes a second: between 10 seconds and a minute of loop.
  assert.ok(music.length >= 80_000 && music.length <= 480_000);
});

test("a hold music file that can't be read leaves silence, and is tried again next time", async () => {
  let reads = 0;
  const load = holdMusicLoader(async () => {
    reads += 1;
    throw new Error("ENOENT");
  });
  assert.equal(await load(), null);
  assert.equal(await load(), null);
  assert.equal(reads, 2);
});
