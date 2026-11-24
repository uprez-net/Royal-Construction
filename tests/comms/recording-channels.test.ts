import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { describe, test } from "vitest";

import {
  encodeWavPcm16,
  mp3HasTwoChannels,
  splitStereoMp3,
} from "@/lib/comms/audio/stereo";
import { PROMPTS } from "@/lib/domain/comms/calls/flow";
import {
  channelTranscript,
  HANDOVER_WORDS,
  transcribeCallRecording,
} from "@/lib/domain/comms/calls/transcripts";
import type {
  CallTranscriptionPort,
  TranscriptSegment,
} from "@/lib/domain/ports/transcription";
import { systemPrincipal } from "@/lib/domain/principal";

import { recordingDb } from "../architecture/domain-harness";
import { REPO_ROOT } from "../support/repo-root";

// A call recording has the customer's leg on one channel and what was played
// to them on the other. Transcribed a channel at a time, who said what is
// exact rather than a text model's guess (#613).

const SYSTEM = systemPrincipal("test:recording-channels");
const MILI_CALL = { answeredBy: "AGENT", direction: "INBOUND" } as const;

const seg = (
  channel: 0 | 1,
  startSecond: number,
  text: string,
): TranscriptSegment => ({
  channel,
  endSecond: startSecond + 1,
  startSecond,
  text,
});

describe("lines by channel", () => {
  test("a call Mili answered: the caller and Mili, in the order spoken", () => {
    const text = channelTranscript(
      [
        seg(0, 10.8, "Can you check the job on Example Street?"),
        seg(1, 3.2, "Hi, you're speaking with Mili."),
        seg(1, 7.5, "How can I help you today?"),
        seg(1, 16, "Sure."),
        seg(0, 27.6, "Yeah, please check."),
      ],
      { call: MILI_CALL, kind: "CALL" },
    );
    assert.equal(
      text,
      [
        "Mili: Hi, you're speaking with Mili. How can I help you today?",
        "Caller: Can you check the job on Example Street?",
        "Mili: Sure.",
        "Caller: Yeah, please check.",
      ].join("\n"),
    );
  });

  test("after Mili hands over, the second channel is the team, announcement included", () => {
    const text = channelTranscript(
      [
        seg(1, 20, "Let me check what I have in front of me."),
        seg(0, 68, "I need to get going."),
        seg(1, 74.8, "Okay, hang on."),
        seg(1, 90.8, "No worries."),
        seg(1, 91.8, "I'll put you through to the team now."),
        seg(1, 98, "Hi, it's the office here."),
        seg(0, 101, "Oh hi."),
      ],
      { call: MILI_CALL, kind: "CALL" },
    );
    assert.equal(
      text,
      [
        "Mili: Let me check what I have in front of me.",
        "Caller: I need to get going.",
        "Mili: Okay, hang on.",
        "Royal: No worries. I'll put you through to the team now. Hi, it's the office here.",
        "Caller: Oh hi.",
      ].join("\n"),
    );
  });

  test("an announcement cut across segments is still the handover", () => {
    const text = channelTranscript(
      [
        seg(1, 20, "Let me check that for you."),
        seg(0, 60, "I need to go."),
        seg(1, 90.8, "No worries. I'll put you through"),
        seg(1, 92.4, "to the team now."),
        seg(1, 98, "Hi, it's the office here."),
      ],
      { call: MILI_CALL, kind: "CALL" },
    );
    assert.equal(
      text,
      [
        "Mili: Let me check that for you.",
        "Caller: I need to go.",
        "Royal: No worries. I'll put you through to the team now. Hi, it's the office here.",
      ].join("\n"),
    );
  });

  test("both handover announcements are recognised", () => {
    for (const prompt of [PROMPTS.agentTransfer, PROMPTS.agentUnavailable]) {
      assert.ok(prompt.toLowerCase().includes(HANDOVER_WORDS), prompt);
    }
  });

  test("an outbound call is the team and the contact; a staff-answered call the team and the caller", () => {
    const segments = [seg(1, 1, "Hello, Royal here."), seg(0, 3, "Hi.")];
    assert.equal(
      channelTranscript(segments, {
        call: { answeredBy: "BROWSER", direction: "OUTBOUND" },
        kind: "CALL",
      }),
      "Royal: Hello, Royal here.\nContact: Hi.",
    );
    assert.equal(
      channelTranscript(segments, {
        call: { answeredBy: "MOBILE", direction: "INBOUND" },
        kind: "CALL",
      }),
      "Royal: Hello, Royal here.\nCaller: Hi.",
    );
  });

  test("nobody spoke is empty; a voicemail is never split by channel", () => {
    assert.equal(channelTranscript([], { call: MILI_CALL, kind: "CALL" }), "");
    assert.equal(
      channelTranscript([seg(0, 1, "Hi")], {
        call: MILI_CALL,
        kind: "VOICEMAIL",
      }),
      null,
    );
  });
});

describe("the transcription command", () => {
  function stored(provider: "TELNYX" | "TWILIO") {
    return {
      blobUrl: "https://store.example/call-recordings/c1/abc.mp3",
      byteSize: 1_000,
      call: MILI_CALL,
      id: "rec-1",
      kind: "CALL",
      mimeType: "audio/mpeg",
      provider,
      status: "STORED",
      transcriptAttempts: 0,
      transcriptStatus: "PENDING",
    };
  }

  async function run(
    provider: "TELNYX" | "TWILIO",
    answer: Awaited<ReturnType<CallTranscriptionPort>>,
  ) {
    const harness = recordingDb({
      "callRecording.findUnique": stored(provider),
    });
    const asked: Parameters<CallTranscriptionPort>[0][] = [];
    let split = 0;
    const outcome = await transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      harness.db,
      {
        speakers: async () => {
          split += 1;
          return [{ speaker: "Caller", text: answer?.text ?? "" }];
        },
        transcribe: async (audio) => {
          asked.push(audio);
          return answer;
        },
      },
    );
    const last = harness
      .writes()
      .filter((call) => call.operation === "callRecording.updateMany")
      .map((call) => (call.args as { data: Record<string, unknown> }).data)
      .at(-1);
    return { asked, last, outcome, split };
  }

  test("a Telnyx call recording is transcribed by channel and labelled without a model guessing", async () => {
    const { asked, last, outcome, split } = await run("TELNYX", {
      segments: [
        seg(1, 1, "Hi, you're speaking with Mili."),
        seg(0, 4, "Hello."),
      ],
      text: "Hi, you're speaking with Mili. Hello.",
    });
    assert.equal(outcome, "transcribed");
    assert.equal(asked[0]?.splitChannels, true);
    assert.equal(split, 0, "no text model is asked who said what");
    assert.equal(
      last?.transcript,
      "Mili: Hi, you're speaking with Mili.\nCaller: Hello.",
    );
    assert.equal(last?.transcriptStatus, "DONE");
  });

  test("silence on both channels is empty", async () => {
    const { last, outcome } = await run("TELNYX", { segments: [], text: "" });
    assert.equal(outcome, "empty");
    assert.equal(last?.transcriptStatus, "EMPTY");
  });

  test("a recording that could not be split keeps the speaker split", async () => {
    const { last, split } = await run("TELNYX", { text: "Hello there." });
    assert.equal(split, 1);
    assert.equal(last?.transcript, "Caller: Hello there.");
  });

  test("Twilio's channel order is unverified: no channel split is asked for", async () => {
    const { asked } = await run("TWILIO", { text: "Hello there." });
    assert.equal(asked[0]?.splitChannels, undefined);
  });
});

describe("the audio", () => {
  test("a stereo MP3 splits into one WAV per channel, the right way round", async () => {
    const mp3 = await readFile(
      `${REPO_ROOT}/tests/comms/fixtures/stereo-left-tone.mp3`,
    );
    const split = await splitStereoMp3(new Uint8Array(mp3));
    assert.ok(split, "decoded");
    const [left, right] = split;
    assert.ok(Math.abs(left.seconds - 1) < 0.1, String(left.seconds));
    const loudness = (wav: Uint8Array) => {
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let peak = 0;
      for (let i = 44; i + 1 < wav.length; i += 2) {
        peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
      }
      return peak;
    };
    assert.ok(loudness(left.wav) > 2_000, "the tone is on the first channel");
    assert.ok(loudness(right.wav) < 500, "the second channel is silent");
  });

  test("anything that is not a stereo MP3 is left for the mixed transcription", async () => {
    assert.equal(await splitStereoMp3(new Uint8Array([1, 2, 3, 4])), null);
  });

  test("a mono MP3 is not split, though the decoder would hand it back as two channels", async () => {
    const fixture = async (name: string) =>
      new Uint8Array(
        await readFile(`${REPO_ROOT}/tests/comms/fixtures/${name}`),
      );
    const mono = await fixture("mono-tone.mp3");
    assert.equal(mp3HasTwoChannels(mono), false);
    assert.equal(await splitStereoMp3(mono), null);
    assert.equal(
      mp3HasTwoChannels(await fixture("stereo-left-tone.mp3")),
      true,
    );
    assert.equal(mp3HasTwoChannels(new Uint8Array([1, 2, 3, 4])), null);
  });

  test("the WAV is 16-bit mono PCM at the recording's rate", () => {
    const wav = encodeWavPcm16(new Float32Array([0, 1, -1]), 8_000);
    const view = new DataView(wav.buffer);
    const tag = (at: number) =>
      String.fromCharCode(...wav.subarray(at, at + 4));
    assert.equal(tag(0), "RIFF");
    assert.equal(tag(8), "WAVE");
    assert.equal(view.getUint16(20, true), 1, "PCM");
    assert.equal(view.getUint16(22, true), 1, "mono");
    assert.equal(view.getUint32(24, true), 8_000);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), 6);
    assert.deepEqual(
      [
        view.getInt16(44, true),
        view.getInt16(46, true),
        view.getInt16(48, true),
      ],
      [0, 32767, -32768],
    );
  });
});
