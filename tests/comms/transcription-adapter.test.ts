import assert from "node:assert/strict";
import { test, vi } from "vitest";

// The AI Gateway transcription adapter. A recording with nobody speaking (a
// hang-up, an empty voicemail) makes the SDK throw NoTranscriptGeneratedError;
// that is empty text, not a failure to retry and then report.

const sdk = vi.hoisted(() => ({ transcribe: vi.fn() }));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  transcribe: sdk.transcribe,
}));
vi.mock("@/lib/blob-port", () => ({
  readStoredBlob: async () => ({
    stream: new Response(new Uint8Array([1, 2, 3])).body,
  }),
}));
vi.mock("@/lib/model", () => ({
  TRANSCRIPTION_MODEL_ID: "test/model",
  gateway: { transcription: () => ({}) },
}));

const { NoTranscriptGeneratedError } = await import("ai");
const { gatewayCallTranscription } = await import("@/lib/comms/transcription");

const AUDIO = {
  blobUrl: "https://blob.example/recording.mp3",
  kind: "VOICEMAIL",
  mimeType: "audio/mpeg",
} as Parameters<typeof gatewayCallTranscription>[0];

test("silent audio is empty text, not a failure", async () => {
  sdk.transcribe.mockImplementation(async () => {
    throw new NoTranscriptGeneratedError({ responses: [] });
  });
  assert.deepEqual(await gatewayCallTranscription(AUDIO), { text: "" });
});

test("any other model failure still throws", async () => {
  sdk.transcribe.mockImplementation(async () => {
    throw new Error("gateway down");
  });
  await assert.rejects(gatewayCallTranscription(AUDIO), /gateway down/);
});

test("speech comes back as the model's text", async () => {
  sdk.transcribe.mockResolvedValue({ text: "Hi, it's Sam about the duplex." });
  assert.deepEqual(await gatewayCallTranscription(AUDIO), {
    text: "Hi, it's Sam about the duplex.",
  });
});
