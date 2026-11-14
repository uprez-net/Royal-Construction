import assert from "node:assert/strict";
import { test } from "vitest";

import {
  MAX_RECORDING_ATTEMPTS,
  storeCallRecording,
} from "@/lib/domain/comms/calls/recordings";
import { DomainSideEffectError } from "@/lib/domain/errors";
import type { BlobPutPort } from "@/lib/domain/ports/blob";
import type { RecordingPort } from "@/lib/domain/ports/comms";
import { systemPrincipal } from "@/lib/domain/principal";

import { recordingDb } from "../architecture/domain-harness";

// Copying a call recording into Royal's storage: a recording that cannot be
// kept must say why on the row — never sit PENDING with no reason while the
// workflow reports only a generic failure.

const SYSTEM = systemPrincipal("test:recordings");

function pending(attempts = 0) {
  return {
    attempts,
    blobPathname: null,
    callId: "call-1",
    id: "rec-1",
    provider: "TELNYX",
    providerDeletedAt: null,
    providerRecordingId: "tx-rec-1",
    status: "PENDING",
  };
}

function telnyx(
  mimeType = "audio/mpeg",
): RecordingPort & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    deleteRecording: async (id) => {
      deleted.push(id);
    },
    fetchRecording: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType,
    }),
    provider: "telnyx",
  };
}

const updates = (harness: ReturnType<typeof recordingDb>) =>
  harness
    .writes()
    .filter((call) => call.operation === "callRecording.update")
    .map((call) => (call.args as { data: Record<string, unknown> }).data);

test("storage refusing the upload is recorded on the recording and retried", async () => {
  const harness = recordingDb({ "callRecording.findUnique": pending() });
  const port = telnyx();
  const put: BlobPutPort = async () => {
    throw new Error("store unavailable: blob put refused");
  };
  await assert.rejects(
    storeCallRecording(SYSTEM, { recordingId: "rec-1" }, harness.db, {
      put,
      recordingsFor: () => port,
    }),
    (error: unknown) =>
      error instanceof DomainSideEffectError && error.retryable === true,
  );
  const last = updates(harness).at(-1);
  assert.match(
    String(last?.failureReason),
    /couldn't be saved to storage\. store unavailable: blob put refused/,
  );
  assert.equal(last?.status, undefined, "still pending: it will be retried");
  assert.deepEqual(
    port.deleted,
    [],
    "the carrier's copy is kept for the retry",
  );
});

test("on the last attempt a storage failure leaves the recording FAILED, with the reason", async () => {
  const harness = recordingDb({
    "callRecording.findUnique": pending(MAX_RECORDING_ATTEMPTS - 1),
  });
  await assert.rejects(
    storeCallRecording(SYSTEM, { recordingId: "rec-1" }, harness.db, {
      put: async () => {
        throw new Error("store unavailable");
      },
      recordingsFor: () => telnyx(),
    }),
    (error: unknown) =>
      error instanceof DomainSideEffectError && error.retryable === false,
  );
  const last = updates(harness).at(-1);
  assert.equal(last?.status, "FAILED");
  assert.match(String(last?.failureReason), /store unavailable/);
});

test("a WAV recording is stored as WAV, then removed from the carrier", async () => {
  const harness = recordingDb({ "callRecording.findUnique": pending() });
  const port = telnyx("audio/wav");
  const puts: { pathname: string; contentType?: string }[] = [];
  const outcome = await storeCallRecording(
    SYSTEM,
    { recordingId: "rec-1" },
    harness.db,
    {
      put: async (input) => {
        puts.push({ contentType: input.contentType, pathname: input.pathname });
        return { url: "https://x.private.blob.vercel-storage.com/r.wav" };
      },
      recordingsFor: () => port,
    },
  );
  assert.equal(outcome, "stored");
  assert.match(
    puts[0].pathname,
    /^call-recordings\/call-1\/[0-9a-f]{32}\.wav$/,
  );
  assert.equal(puts[0].contentType, "audio/wav");
  assert.deepEqual(port.deleted, ["tx-rec-1"]);
});
