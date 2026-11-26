import assert from "node:assert/strict";
import { test } from "vitest";

import {
  EVENT_FLUSH_MS,
  EVENT_MAX_BATCH,
  voiceAgentEventWriter,
  type EventBatch,
} from "@/lib/comms/voice-agent/event-writer";
import {
  TURN_QUIET_MS,
  type VoiceAgentEventSink,
} from "@/lib/comms/voice-agent/session";
import { recordVoiceAgentEvents } from "@/lib/domain/comms/calls/agent-events";
import { voiceLookupResultCue } from "@/lib/domain/comms/calls/voice-agent";
import { VOICE_LOOKUPS } from "@/lib/domain/comms/callers/lookups";
import { systemPrincipal } from "@/lib/domain/principal";

import { recordingDb } from "../architecture/domain-harness";
import { started } from "./voice-agent-harness";

// What the call desk did on a call is kept as events, written off the
// conversation's path: the session hands them over and moves on, and a slow
// or failing write never holds up what Mili says next.

const CALL = { callId: "call-1", providerCallId: "v3:abc" };
const at = new Date("2026-11-26T00:00:00Z");

function timers() {
  const pending: { fn: () => void; ms: number; live: boolean }[] = [];
  return {
    clearTimer: (handle: unknown) => {
      (handle as { live: boolean }).live = false;
    },
    fire: () => {
      for (const timer of pending.filter((t) => t.live)) {
        timer.live = false;
        timer.fn();
      }
    },
    pending,
    setTimer: (fn: () => void, ms: number) => {
      const timer = { fn, live: true, ms };
      pending.push(timer);
      return timer;
    },
  };
}

test("events wait a moment to share a write, go in order, and flush on demand", async () => {
  const writes: EventBatch[] = [];
  const t = timers();
  const sink = voiceAgentEventWriter(async (batch) => {
    writes.push(batch);
  }, t);
  sink.emit(CALL, { at, kind: "session.started" });
  sink.emit(CALL, { at, kind: "desk.lookup" });
  assert.equal(writes.length, 0, "emit never writes inline");
  assert.equal(t.pending[0].ms, EVENT_FLUSH_MS);
  t.fire();
  await sink.flush();
  assert.deepEqual(
    writes.map((batch) => batch.events.map((event) => event.kind)),
    [["session.started", "desk.lookup"]],
  );
  assert.equal(writes[0].callId, "call-1");
});

test("a full batch goes at once, and a failed write is dropped without breaking the next", async () => {
  const kept: number[] = [];
  let first = true;
  const sink = voiceAgentEventWriter(
    async (batch) => {
      if (first) {
        first = false;
        throw new Error("database down");
      }
      kept.push(batch.events.length);
    },
    { ...timers(), log: { warn: () => {} } },
  );
  for (let i = 0; i < EVENT_MAX_BATCH; i += 1) {
    sink.emit(CALL, { at, kind: "desk.lookup" });
  }
  sink.emit(CALL, { at, kind: "session.ended" });
  await sink.flush();
  assert.deepEqual(kept, [1]);
});

test("the session records a lookup with its answer and timing, without waiting on the write", async () => {
  const emitted: { kind: string; detail?: Record<string, unknown> | null }[] =
    [];
  let flushed = false;
  const sink: VoiceAgentEventSink = {
    emit: (_call, event) => {
      emitted.push(event);
    },
    flush: () =>
      new Promise((resolve) => {
        flushed = true;
        resolve();
      }),
  };
  const lookups = VOICE_LOOKUPS.filter((l) => l.classes.includes("admin"));
  const h = await started(
    async () => ({
      action: "lookup",
      request: { name: "project_status", project: "Ridge" },
    }),
    async () => ({
      greetingCue: "cue",
      instructions: "x",
      lookup: async () => "Ridge Street Build: delayed.",
      lookups,
    }),
    { events: sink },
  );
  h.session.handleModelEvent({
    delta: "One moment, let me check that.",
    endMs: 100,
    startMs: 0,
    type: "session.output_transcript.delta",
  });
  h.fire(TURN_QUIET_MS);
  await h.tick();
  assert.deepEqual(h.modelOut.at(-1), {
    content: voiceLookupResultCue("Ridge Street Build: delayed."),
    delegation_id: null,
    type: "session.commentary.append",
  });
  const lookup = emitted.find((event) => event.kind === "desk.lookup");
  assert.equal(lookup?.detail?.name, "project_status");
  assert.equal(lookup?.detail?.answer, "Ridge Street Build: delayed.");
  assert.deepEqual(lookup?.detail?.args, { project: "Ridge" });
  assert.equal(typeof lookup?.detail?.ms, "number");

  await h.session.finish("completed");
  assert.equal(emitted.at(-1)?.kind, "session.ended");
  assert.equal(
    flushed,
    true,
    "the last events land before the function may stop",
  );
});

test("events are kept only for the call the stream's token named", async () => {
  const other = recordingDb({
    "call.findUnique": {
      id: "call-1",
      ownerCall: null,
      providerCallId: "v3:other",
    },
  });
  assert.equal(
    await recordVoiceAgentEvents(
      systemPrincipal("comms-webhook"),
      { ...CALL, events: [{ at, kind: "desk.lookup" }] },
      other.db,
    ),
    0,
  );
  assert.deepEqual(other.writes(), []);

  const owner = recordingDb({
    "call.findUnique": {
      id: "call-1",
      ownerCall: { id: "oc-1" },
      providerCallId: "v3:abc",
    },
  });
  await recordVoiceAgentEvents(
    systemPrincipal("comms-webhook"),
    {
      ...CALL,
      events: [
        { at, detail: { answer: "y".repeat(10_000) }, kind: "desk.lookup" },
      ],
    },
    owner.db,
  );
  const row = (
    owner.writes()[0].args as {
      data: { ownerCallId: string; detail: { answer: string } }[];
    }
  ).data[0];
  assert.equal(row.ownerCallId, "oc-1", "filed on the owner call too");
  assert.ok(row.detail.answer.length <= 4_000, "a runaway answer is bounded");
});
