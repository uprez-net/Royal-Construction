import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MAX_TRANSCRIBE_BYTES,
  MAX_TRANSCRIPT_ATTEMPTS,
  normaliseTranscript,
  transcribeCallRecording,
} from "@/lib/domain/comms/calls/transcripts";
import { recordingsNeedingWork } from "@/lib/domain/comms/calls/recordings";
import {
  DomainAuthorizationError,
  DomainSideEffectError,
} from "@/lib/domain/errors";
import type { CallTranscriptionPort } from "@/lib/domain/ports/transcription";
import { systemPrincipal } from "@/lib/domain/principal";

import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// Every stored recording is transcribed, and a recording that cannot be must
// say why on the row — never sit PENDING for ever, and never cost a re-download.

const SYSTEM = systemPrincipal("test:transcripts");

function stored(overrides: Record<string, unknown> = {}) {
  return {
    blobUrl: "https://store.example/call-recordings/c1/abc.mp3",
    byteSize: 1_000,
    id: "rec-1",
    kind: "CALL",
    mimeType: "audio/mpeg",
    status: "STORED",
    transcriptAttempts: 0,
    transcriptStatus: "PENDING",
    ...overrides,
  };
}

function port(answer: Awaited<ReturnType<CallTranscriptionPort>> | Error) {
  const seen: Parameters<CallTranscriptionPort>[0][] = [];
  const transcribe: CallTranscriptionPort = async (audio) => {
    seen.push(audio);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { seen, transcribe };
}

const updates = (harness: ReturnType<typeof recordingDb>) =>
  harness
    .writes()
    .filter((call) => call.operation === "callRecording.update")
    .map((call) => (call.args as { data: Record<string, unknown> }).data);

test("a stored recording is transcribed and the text kept on it", async () => {
  const harness = recordingDb({ "callRecording.findUnique": stored() });
  const model = port({
    text: "  Hi,   it's Sam about the knockdown rebuild.  ",
  });
  const outcome = await transcribeCallRecording(
    SYSTEM,
    { recordingId: "rec-1" },
    harness.db,
    model,
  );
  assert.equal(outcome, "transcribed");
  assert.deepEqual(model.seen, [
    {
      blobUrl: "https://store.example/call-recordings/c1/abc.mp3",
      kind: "CALL",
      mimeType: "audio/mpeg",
    },
  ]);
  const last = updates(harness).at(-1);
  assert.equal(last?.transcriptStatus, "DONE");
  assert.equal(last?.transcript, "Hi, it's Sam about the knockdown rebuild.");
  assert.equal(last?.transcriptFailure, null);
});

test("silence is an answer, not a failure", async () => {
  const harness = recordingDb({ "callRecording.findUnique": stored() });
  const outcome = await transcribeCallRecording(
    SYSTEM,
    { recordingId: "rec-1" },
    harness.db,
    port({ text: "   " }),
  );
  assert.equal(outcome, "empty");
  assert.equal(updates(harness).at(-1)?.transcriptStatus, "EMPTY");
});

test("a model failure is recorded and retried, then given up on", async () => {
  const harness = recordingDb({ "callRecording.findUnique": stored() });
  await assert.rejects(
    transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      harness.db,
      port(new Error("gateway 503")),
    ),
    (error: unknown) =>
      error instanceof DomainSideEffectError && error.retryable === true,
  );
  const last = updates(harness).at(-1);
  assert.match(String(last?.transcriptFailure), /couldn't be transcribed/);
  assert.equal(last?.transcriptStatus, undefined, "still pending: retried");

  const final = recordingDb({
    "callRecording.findUnique": stored({
      transcriptAttempts: MAX_TRANSCRIPT_ATTEMPTS - 1,
    }),
  });
  await assert.rejects(
    transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      final.db,
      port(new Error("gateway 503")),
    ),
    (error: unknown) =>
      error instanceof DomainSideEffectError && error.retryable === false,
  );
  assert.equal(updates(final).at(-1)?.transcriptStatus, "FAILED");
});

test("a recording not stored yet is left for the sweep, untouched", async () => {
  const harness = recordingDb({
    "callRecording.findUnique": stored({ blobUrl: null, status: "PENDING" }),
  });
  const model = port({ text: "never asked" });
  const outcome = await transcribeCallRecording(
    SYSTEM,
    { recordingId: "rec-1" },
    harness.db,
    model,
  );
  assert.equal(outcome, "not_ready");
  assert.deepEqual(harness.writes(), []);
  assert.deepEqual(model.seen, []);
});

test("a replay of a transcribed recording does nothing", async () => {
  const harness = recordingDb({
    "callRecording.findUnique": stored({ transcriptStatus: "DONE" }),
  });
  const model = port({ text: "never asked" });
  assert.equal(
    await transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      harness.db,
      model,
    ),
    "already_done",
  );
  assert.deepEqual(harness.writes(), []);
  assert.deepEqual(model.seen, []);
});

test("an oversized recording is skipped with the reason, never sent", async () => {
  const harness = recordingDb({
    "callRecording.findUnique": stored({ byteSize: MAX_TRANSCRIBE_BYTES + 1 }),
  });
  const model = port({ text: "never asked" });
  assert.equal(
    await transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      harness.db,
      model,
    ),
    "skipped",
  );
  assert.equal(updates(harness).at(-1)?.transcriptStatus, "SKIPPED");
  assert.deepEqual(model.seen, []);
});

test("a stored copy that has gone missing fails without retrying the model", async () => {
  const harness = recordingDb({ "callRecording.findUnique": stored() });
  assert.equal(
    await transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      harness.db,
      port(null),
    ),
    "gave_up",
  );
  assert.equal(updates(harness).at(-1)?.transcriptStatus, "FAILED");
});

test("only the recording workflow transcribes", async () => {
  const harness = recordingDb();
  await assert.rejects(
    transcribeCallRecording(
      adminPrincipal(),
      { recordingId: "rec-1" },
      harness.db,
      port({ text: "x" }),
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(harness.calls, []);
});

test("the sweep picks up stored recordings still waiting for a transcript", async () => {
  let where: unknown;
  const harness = recordingDb({
    "callRecording.findMany": (args: unknown) => {
      where = (args as { where: unknown }).where;
      return [{ id: "rec-1" }];
    },
  });
  assert.deepEqual(await recordingsNeedingWork(harness.db), ["rec-1"]);
  assert.deepEqual((where as { OR: unknown[] }).OR.at(-1), {
    status: "STORED",
    transcriptStatus: "PENDING",
  });
});

test("a transcript is tidied and capped", () => {
  assert.equal(normaliseTranscript("a  b\n\n\n\nc "), "a b\n\nc");
  const long = normaliseTranscript("word ".repeat(30_000));
  assert.ok(long.length <= 100_000);
  assert.ok(long.endsWith("…"));
});
