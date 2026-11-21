import assert from "node:assert/strict";
import { test } from "vitest";

import { transcriptTurns } from "@/lib/domain/comms/calls/transcript-lines";
import {
  MAX_SPEAKER_SPLIT_CHARS,
  recordingSpeakers,
  speakerLines,
  transcribeCallRecording,
} from "@/lib/domain/comms/calls/transcripts";
import type { TranscriptSpeakerPort } from "@/lib/domain/ports/transcription";
import { systemPrincipal } from "@/lib/domain/principal";

import { recordingDb } from "../architecture/domain-harness";

// A recording's speech-to-text comes back as one block of prose. It is split
// into "Speaker: text" turns only when the split keeps every word, in order,
// and uses only the labels offered; anything else keeps the prose.

const SYSTEM = systemPrincipal("test:transcript-speakers");
const PROSE =
  "Royal Constructions, this is Dana. Hi Dana, it's Sam about the duplex in Oran Park. Great, how can I help?";
const TURNS = [
  { speaker: "Royal", text: "Royal Constructions, this is Dana." },
  {
    speaker: "Caller",
    text: "Hi Dana, it's Sam about the duplex in Oran Park.",
  },
  { speaker: "Royal", text: "Great, how can I help?" },
];

function stored(call: unknown, kind = "CALL") {
  return {
    blobUrl: "https://store.example/call-recordings/c1/abc.mp3",
    byteSize: 1_000,
    call,
    id: "rec-1",
    kind,
    mimeType: "audio/mpeg",
    status: "STORED",
    transcriptAttempts: 0,
    transcriptStatus: "PENDING",
  };
}

const INBOUND_STAFF = { answeredBy: "BROWSER", direction: "INBOUND" };

async function run(
  recording: ReturnType<typeof stored>,
  speakers: TranscriptSpeakerPort,
  text = PROSE,
) {
  const harness = recordingDb({ "callRecording.findUnique": recording });
  const seen: Parameters<TranscriptSpeakerPort>[0][] = [];
  const outcome = await transcribeCallRecording(
    SYSTEM,
    { recordingId: "rec-1" },
    harness.db,
    {
      speakers: async (input) => {
        seen.push(input);
        return speakers(input);
      },
      transcribe: async () => ({ text }),
    },
  );
  const last = harness
    .writes()
    .filter((call) => call.operation === "callRecording.updateMany")
    .map((call) => (call.args as { data: Record<string, unknown> }).data)
    .at(-1);
  return { outcome, seen, transcript: last?.transcript };
}

test("a call recording is kept one line per speaker", async () => {
  const { outcome, seen, transcript } = await run(
    stored(INBOUND_STAFF),
    async () => TURNS,
  );
  assert.equal(outcome, "transcribed");
  assert.deepEqual(seen[0]?.speakers, ["Royal", "Caller"]);
  assert.equal(
    transcript,
    [
      "Royal: Royal Constructions, this is Dana.",
      "Caller: Hi Dana, it's Sam about the duplex in Oran Park.",
      "Royal: Great, how can I help?",
    ].join("\n"),
  );
  assert.deepEqual(transcriptTurns(transcript as string)?.length, 3);
});

test("a split that drops, adds or changes a word keeps the prose", async () => {
  for (const turns of [
    TURNS.slice(0, 2),
    [...TURNS, { speaker: "Caller", text: "Thanks." }],
    [
      TURNS[0],
      {
        speaker: "Caller",
        text: "Hi Dana, it's Sam about the house in Oran Park.",
      },
      TURNS[2],
    ],
  ]) {
    const { outcome, transcript } = await run(
      stored(INBOUND_STAFF),
      async () => turns,
    );
    assert.equal(outcome, "transcribed");
    assert.equal(transcript, PROSE);
  }
});

test("a label that was not offered, or a failed split, keeps the prose", async () => {
  const wrongLabel = await run(stored(INBOUND_STAFF), async () =>
    TURNS.map((turn) => ({
      ...turn,
      speaker: turn.speaker === "Royal" ? "Mili" : "Caller",
    })),
  );
  assert.equal(wrongLabel.transcript, PROSE);
  const failed = await run(stored(INBOUND_STAFF), async () => {
    throw new Error("gateway down");
  });
  assert.equal(failed.outcome, "transcribed", "the transcript is still kept");
  assert.equal(failed.transcript, PROSE);
});

test("a voicemail, an over-long call or a call with no row is not split", async () => {
  const never: TranscriptSpeakerPort = async () => assert.fail("not asked");
  assert.equal(
    (await run(stored(INBOUND_STAFF, "VOICEMAIL"), never)).transcript,
    PROSE,
  );
  assert.equal((await run(stored(null), never)).transcript, PROSE);
  const long = "word ".repeat(MAX_SPEAKER_SPLIT_CHARS / 4).trim();
  assert.equal(
    (await run(stored(INBOUND_STAFF), never, long)).transcript,
    long,
  );
});

test("who may speak follows who answered and which way the call went", () => {
  assert.deepEqual(
    recordingSpeakers({
      call: { answeredBy: "AGENT", direction: "INBOUND" },
      kind: "CALL",
    })?.speakers,
    ["Mili", "Caller", "Royal"],
  );
  assert.deepEqual(
    recordingSpeakers({
      call: { answeredBy: null, direction: "OUTBOUND" },
      kind: "CALL",
    })?.speakers,
    ["Royal", "Contact"],
  );
  assert.deepEqual(
    recordingSpeakers({
      call: { answeredBy: "MOBILE", direction: "INBOUND" },
      kind: "CALL",
    })?.speakers,
    ["Royal", "Caller"],
  );
});

test("punctuation may differ; a speaker's back-to-back turns are joined", () => {
  assert.equal(
    speakerLines(
      "hi it's sam. about the duplex",
      [
        { speaker: "Caller", text: "Hi, it's Sam." },
        { speaker: "Caller", text: "About the duplex?" },
      ],
      ["Royal", "Caller"],
    ),
    "Caller: Hi, it's Sam. About the duplex?",
  );
});

test("only a transcript whose every line has a known speaker is shown by speaker", () => {
  assert.deepEqual(transcriptTurns("Mili: Hi.\nCaller: Hello."), [
    { speaker: "Mili", text: "Hi." },
    { speaker: "Caller", text: "Hello." },
  ]);
  assert.equal(transcriptTurns("Note: call me back after 3."), null);
  assert.equal(transcriptTurns("Royal: Hi.\nand then the line dropped"), null);
  assert.equal(transcriptTurns(PROSE), null);
  assert.equal(transcriptTurns(null), null);
});
