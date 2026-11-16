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
    .filter((call) => call.operation === "callRecording.updateMany")
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

test("the transcript backlog cannot crowd out recordings still on the carrier", async () => {
  const queries: { where: unknown; take: unknown }[] = [];
  const harness = recordingDb({
    "callRecording.findMany": (args: unknown) => {
      const { where, take } = args as { where: unknown; take: unknown };
      queries.push({ take, where });
      // rec-2 is both still on the carrier and untranscribed: listed once.
      return queries.length === 1
        ? [{ id: "rec-1" }, { id: "rec-2" }]
        : [{ id: "rec-2" }, { id: "rec-3" }];
    },
  });
  assert.deepEqual(await recordingsNeedingWork(harness.db), [
    "rec-1",
    "rec-2",
    "rec-3",
  ]);
  assert.deepEqual(
    queries.map((query) => query.take),
    [100, 100],
    "each kind of work has its own limit",
  );
  assert.deepEqual(queries[1].where, {
    status: "STORED",
    transcriptStatus: "PENDING",
  });
});

test("a recording another run has claimed is not sent to the model again", async () => {
  const harness = recordingDb({
    "callRecording.findUnique": stored(),
    "callRecording.updateMany": { count: 0 },
  });
  const model = port({ text: "never asked" });
  assert.equal(
    await transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      harness.db,
      model,
    ),
    "superseded",
  );
  assert.deepEqual(model.seen, []);
  const claim = harness.writes()[0].args as {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  };
  assert.deepEqual(claim.data, { transcriptAttempts: 1 });
  assert.deepEqual(claim.where, {
    id: "rec-1",
    transcriptAttempts: 0,
    transcriptStatus: "PENDING",
  });
});

test("a result is kept only while this run's claim still stands", async () => {
  let call = 0;
  const harness = recordingDb({
    "callRecording.findUnique": stored(),
    // The claim lands; by the time the model answers, a later run has claimed.
    "callRecording.updateMany": () => ({ count: call++ === 0 ? 1 : 0 }),
  });
  assert.equal(
    await transcribeCallRecording(
      SYSTEM,
      { recordingId: "rec-1" },
      harness.db,
      port({ text: "hello" }),
    ),
    "superseded",
  );
  const settle = harness.writes()[1].args as {
    where: Record<string, unknown>;
  };
  assert.equal(settle.where.transcriptAttempts, 1, "conditioned on its claim");
});

test("a transcript is tidied and capped", () => {
  assert.equal(normaliseTranscript("a  b\n\n\n\nc "), "a b\n\nc");
  const long = normaliseTranscript("word ".repeat(30_000));
  assert.ok(long.length <= 100_000);
  assert.ok(long.endsWith("…"));
});
