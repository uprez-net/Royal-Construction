import assert from "node:assert/strict";
import { test } from "vitest";

import {
  deliverOwnerCallHandoff,
  failStaleDeliveredHandoffs,
  handoffResult,
  OWNER_CALL_HANDOFF_LIMITS,
  ownerCallHandoffBody,
  ownerCallHandoffInstructions,
  verifyHandoffActed,
} from "@/lib/domain/comms/calls/owner-call-handoff";
import type { OwnerAssistantPort } from "@/lib/domain/ports/owner-assistant";
import { systemPrincipal } from "@/lib/domain/principal";

import { recordingDb } from "../architecture/domain-harness";

// DELIVERED only means Hermes answered 2xx. These pin what stops a handoff
// Hermes took but did not act on from being quiet: its RESULT line is read, a
// still-unresolved one is reopened once and then failed, the hourly backstop
// catches one no workflow is watching, and a call where the owner said nothing
// is closed without bothering Hermes.

const NOW = new Date("2026-11-27T03:00:00Z");
const WORKFLOW = systemPrincipal("workflow:owner-call-handoff");

type Op = { operation: string; args: unknown };
const ops = (calls: readonly Op[], operation: string) =>
  calls.filter((c) => c.operation === operation);
const eventKinds = (calls: readonly Op[]) =>
  ops(calls, "agentCallEvent.create").map(
    (c) => (c.args as { data: { kind: string } }).data.kind,
  );
const writes = (calls: readonly Op[]) =>
  ops(calls, "ownerCallHandoff.updateMany").map(
    (c) =>
      c.args as {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      },
  );

function row(
  overrides: Record<string, unknown> = {},
  call: Record<string, unknown> = {},
) {
  return {
    attempts: 0,
    callback: null,
    claimId: null,
    deliveredAt: null,
    hermesReply: null,
    id: "h-1",
    lastAttemptAt: null,
    lastError: null,
    ownerCall: {
      call: {
        agentTranscript:
          "Mili: Hi Raj, it's Mili. Have you got a minute?\nCaller: Call me back in five minutes.",
        answeredAt: NOW,
        answeredBy: "AGENT",
        durationSeconds: 95,
        endedAt: NOW,
        id: "call-1",
        recordings: [],
        startedAt: NOW,
        status: "COMPLETED",
        ...call,
      },
      category: "task_update",
      id: "oc-1",
      reference: null,
      subject: "Update",
    },
    readyAt: NOW,
    requests: [
      {
        callBack: true,
        createdAt: NOW,
        request: "Call back with the bookings.",
        source: "owner",
        timing: null,
      },
    ],
    resolution: null,
    resolvedAt: null,
    revision: 0,
    status: "PENDING",
    ...overrides,
  };
}

function assistant(reply: string, sent: string[] = []): OwnerAssistantPort {
  return {
    ask: async () => "",
    handOff: async (handoff) => {
      sent.push(handoff.body);
      return reply;
    },
  };
}

const deliver = (
  recorder: ReturnType<typeof recordingDb>,
  port: OwnerAssistantPort,
) =>
  deliverOwnerCallHandoff(
    WORKFLOW,
    { handoffId: "h-1", now: NOW },
    recorder.transactionalDb,
    { assistant: port },
  );

test("the RESULT marker: the last one in the reply counts, and none means unknown", () => {
  assert.equal(handoffResult("Scheduled it. RESULT: scheduled"), "scheduled");
  assert.equal(
    handoffResult("RESULT: resolved\nactually no.\nRESULT: needs_owner"),
    "needs_owner",
  );
  assert.equal(handoffResult("result: CANNOT (no access)"), "cannot");
  assert.equal(handoffResult("On it."), null);
  assert.equal(handoffResult("The result: unclear"), null);
});

test("Hermes is told to end with a RESULT line", () => {
  const text = ownerCallHandoffInstructions("h-1");
  for (const marker of [
    "RESULT: scheduled",
    "RESULT: resolved",
    "RESULT: needs_owner",
    "RESULT: cannot",
  ]) {
    assert.ok(text.includes(marker), marker);
  }
});

test("delivery: needs_owner or cannot is FAILED at once, never retried, and flagged", async () => {
  for (const result of ["needs_owner", "cannot"]) {
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": row(),
      "ownerCallHandoff.updateMany": { count: 1 },
    });
    const outcome = await deliver(
      recorder,
      assistant(`I need the time.\nRESULT: ${result}`),
    );
    assert.equal(outcome, "needs_attention");
    const last = writes(recorder.calls).at(-1)!;
    assert.equal(last.data.status, "FAILED");
    assert.equal(last.data.attempts, OWNER_CALL_HANDOFF_LIMITS.maxAttempts);
    assert.match(String(last.data.lastError), new RegExp(`said ${result}`));
    assert.equal(last.where.status, "DELIVERED");
    assert.deepEqual(eventKinds(recorder.calls), [
      "handoff.delivered",
      "handoff.failed",
    ]);
  }
});

test("delivery: scheduled, resolved, or no marker stays DELIVERED", async () => {
  for (const reply of ["Done. RESULT: scheduled", "RESULT: resolved", "Ok."]) {
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": row(),
      "ownerCallHandoff.updateMany": { count: 1 },
    });
    assert.equal(await deliver(recorder, assistant(reply)), "delivered");
    assert.deepEqual(eventKinds(recorder.calls), ["handoff.delivered"]);
  }
});

test("delivery: a short call where the owner said nothing is closed, and Hermes is not asked", async () => {
  const sent: string[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row(
      { requests: [] },
      {
        agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
        durationSeconds: 30,
      },
    ),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await deliver(recorder, assistant("never sent", sent)),
    "nothing_asked",
  );
  assert.deepEqual(sent, []);
  const [closed] = writes(recorder.calls);
  assert.equal(closed.data.status, "RESOLVED");
  assert.match(String(closed.data.resolution), /Nothing was asked/);
  assert.deepEqual(eventKinds(recorder.calls), ["handoff.resolved"]);
});

test("delivery: an empty-looking call is still sent when something suggests it was not empty", async () => {
  const silent = {
    agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
  };
  const cases: Array<
    [string, Record<string, unknown>, Record<string, unknown>]
  > = [
    [
      "a request was noted",
      { requests: row().requests },
      { ...silent, durationSeconds: 30 },
    ],
    [
      "it ran long, so words were likely lost",
      { requests: [] },
      { ...silent, durationSeconds: 116 },
    ],
    [
      "it is a reopened revision",
      { requests: [], revision: 1 },
      { ...silent, durationSeconds: 30 },
    ],
    ["the owner spoke", { requests: [] }, { durationSeconds: 30 }],
    [
      "the recording shows the owner spoke even though the live transcript lost it",
      { requests: [] },
      {
        ...silent,
        durationSeconds: 30,
        recordings: [
          {
            transcript:
              "Mili: Hi Raj.\nCaller: Yeah, call me back in five minutes.",
          },
        ],
      },
    ],
    [
      "only an unlabelled recording transcript exists",
      { requests: [] },
      {
        agentTranscript: null,
        durationSeconds: 30,
        recordings: [{ transcript: "call me back in five minutes" }],
      },
    ],
  ];
  for (const [why, handoff, call] of cases) {
    const sent: string[] = [];
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": row(handoff, call),
      "ownerCallHandoff.updateMany": { count: 1 },
    });
    assert.equal(
      await deliver(recorder, assistant("ok", sent)),
      "delivered",
      why,
    );
    assert.equal(sent.length, 1, why);
  }
});

test("the body: a long call with no owner words says the transcript probably lost them", () => {
  const long = row(
    { requests: [] },
    {
      agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
      durationSeconds: 116,
    },
  );
  const text = ownerCallHandoffBody(
    long as never,
    long.ownerCall.call.agentTranscript,
  );
  assert.match(text, /nothing the owner said/);
  assert.match(text, /RESULT: needs_owner/);
  const normal = row();
  assert.doesNotMatch(
    ownerCallHandoffBody(
      normal as never,
      normal.ownerCall.call.agentTranscript,
    ),
    /nothing the owner said/,
  );
});

test("verify: resolved is acted on; anything but DELIVERED is left alone", async () => {
  for (const [status, expected] of [
    ["RESOLVED", "acted"],
    ["PENDING", "skipped"],
    ["FAILED", "skipped"],
  ] as const) {
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": {
        id: "h-1",
        ownerCall: { id: "oc-1" },
        revision: 0,
        status,
      },
    });
    assert.equal(
      await verifyHandoffActed(
        WORKFLOW,
        { final: false, handoffId: "h-1", now: NOW },
        recorder.transactionalDb,
      ),
      expected,
    );
    assert.deepEqual(writes(recorder.calls), []);
  }
});

test("verify: still DELIVERED — the first check reopens it as a new revision, the final one fails it", async () => {
  const delivered = {
    id: "h-1",
    ownerCall: { id: "oc-1" },
    revision: 0,
    status: "DELIVERED",
  };
  const first = recordingDb({
    "ownerCallHandoff.findUnique": delivered,
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await verifyHandoffActed(
      WORKFLOW,
      { final: false, handoffId: "h-1", now: NOW },
      first.transactionalDb,
    ),
    "reopened",
  );
  const [reopen] = writes(first.calls);
  assert.equal(reopen.data.status, "PENDING");
  assert.deepEqual(reopen.data.revision, { increment: 1 });
  assert.equal(reopen.where.status, "DELIVERED");
  assert.match(String(reopen.data.lastError), /did not schedule a callback/);
  assert.deepEqual(eventKinds(first.calls), ["handoff.reopened"]);

  const final = recordingDb({
    "ownerCallHandoff.findUnique": delivered,
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await verifyHandoffActed(
      WORKFLOW,
      { final: true, handoffId: "h-1", now: NOW },
      final.transactionalDb,
    ),
    "failed",
  );
  const [failed] = writes(final.calls);
  assert.equal(failed.data.status, "FAILED");
  assert.equal(failed.data.attempts, OWNER_CALL_HANDOFF_LIMITS.maxAttempts);
  assert.deepEqual(eventKinds(final.calls), ["handoff.failed"]);

  // Overtaken between the read and the write (Hermes resolved it, or it was
  // reopened): nothing is claimed.
  const raced = recordingDb({
    "ownerCallHandoff.findUnique": delivered,
    "ownerCallHandoff.updateMany": { count: 0 },
  });
  assert.equal(
    await verifyHandoffActed(
      WORKFLOW,
      { final: true, handoffId: "h-1", now: NOW },
      raced.transactionalDb,
    ),
    "skipped",
  );
  assert.deepEqual(eventKinds(raced.calls), []);
});

test("backstop: a handoff taken long ago and still unresolved is failed and named", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findMany": [
      { id: "h-1", ownerCall: { id: "oc-1" }, revision: 0 },
      { id: "h-2", ownerCall: { id: "oc-2" }, revision: 2 },
    ],
    "ownerCallHandoff.updateMany": (args: unknown) =>
      (args as { where: { id: string } }).where.id === "h-1"
        ? { count: 1 }
        : { count: 0 },
  });
  const failed = await failStaleDeliveredHandoffs(
    WORKFLOW,
    { now: NOW },
    recorder.transactionalDb,
  );
  assert.deepEqual(failed, ["h-1"]);
  const [find] = ops(recorder.calls, "ownerCallHandoff.findMany");
  const where = (find.args as { where: Record<string, unknown> }).where;
  assert.equal(where.status, "DELIVERED");
  assert.equal(where.resolvedAt, null);
  assert.deepEqual(eventKinds(recorder.calls), ["handoff.failed"]);
});

test("delivery: when the live and recorded transcripts differ, Hermes gets both, the recording first", async () => {
  const sent: string[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row(
      {},
      {
        agentTranscript:
          "Mili: Hi Raj.\nCaller: give me a call back tomorrow or let's say five",
        recordings: [
          {
            transcript:
              "Mili: Hi Raj.\nCaller: Give me a call back in 10 minutes or let's say in 5 minutes.",
          },
        ],
      },
    ),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  const body = sent[0];
  assert.ok(
    body.indexOf("Recording transcript") < body.indexOf("Live transcript"),
  );
  assert.match(body, /Recording transcript \(speech-to-text/);
  assert.match(body, /Live transcript \(what the voice model heard/);
  assert.match(body, /tomorrow or let's say five/);
});

// ── Voicemail (#645) ────────────────────────────────────────────────────

const VOICEMAIL_RECORDING = [
  {
    transcript:
      "Caller: The person you are trying to reach is not available. At the tone, please record your message.\nMili: Hi Raj, it's Mili. Have you got a minute?",
  },
];

function callbackRow(overrides: Record<string, unknown> = {}) {
  const base = row(
    { requests: [], ...overrides },
    {
      agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
      durationSeconds: 116,
      recordings: VOICEMAIL_RECORDING,
    },
  );
  (base.ownerCall as { fromHandoffId?: string | null }).fromHandoffId = "h-src";
  return base;
}

test("voicemail: a callback it answered reopens the handoff it came from, closes its own, and starts the delivery", async () => {
  const sent: string[] = [];
  const started: string[] = [];
  const recorder = recordingDb({
    "ownerCall.findUnique": { fromHandoffId: "h-src" },
    "ownerCallHandoff.findUnique": callbackRow(),
    "ownerCallHandoff.update": { ownerCallId: "oc-src" },
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  const outcome = await deliverOwnerCallHandoff(
    WORKFLOW,
    { handoffId: "h-1", now: NOW },
    recorder.transactionalDb,
    {
      assistant: assistant("never sent", sent),
      startDelivery: async (id) => {
        started.push(id);
      },
    },
  );
  assert.equal(outcome, "voicemail");
  assert.deepEqual(sent, []);
  assert.deepEqual(started, ["h-src"]);
  const [closed] = writes(recorder.calls);
  assert.equal(closed.data.status, "RESOLVED");
  assert.match(String(closed.data.resolution), /voicemail/i);
  // The callback is unlinked, and the source is PENDING again as a new revision.
  const [unlink] = ops(recorder.calls, "ownerCall.update");
  assert.deepEqual((unlink.args as { data: unknown }).data, {
    fromHandoffId: null,
  });
  const [reopen] = ops(recorder.calls, "ownerCallHandoff.update");
  const reopened = reopen.args as {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  };
  assert.equal(reopened.where.id, "h-src");
  assert.equal(reopened.data.status, "PENDING");
  assert.deepEqual(reopened.data.revision, { increment: 1 });
  assert.match(String(reopened.data.lastError), /answered by voicemail/);
  assert.deepEqual(eventKinds(recorder.calls), [
    "handoff.reopened",
    "handoff.resolved",
  ]);
});

test("voicemail: a first briefing that hit it is still sent, with a note, so Hermes can try again", async () => {
  const sent: string[] = [];
  const first = callbackRow();
  (first.ownerCall as { fromHandoffId?: string | null }).fromHandoffId = null;
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": first,
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.match(sent[0], /answered by voicemail/);
  assert.match(sent[0], /Decide whether to try again/);
});

test("voicemail: Mili's own words never count, and a callback a person answered is delivered as usual", async () => {
  const sent: string[] = [];
  const spoken = callbackRow();
  const call = spoken.ownerCall.call as {
    agentTranscript: string;
    recordings: { transcript: string }[];
  };
  call.agentTranscript =
    "Mili: Hi Raj. Sorry, I know you may not be available.\nCaller: Yeah, I've got a minute.";
  call.recordings = [
    {
      transcript:
        "Mili: Hi Raj. Sorry, I know you may not be available.\nCaller: Yeah, I've got a minute.",
    },
  ];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": spoken,
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.doesNotMatch(sent[0], /answered by voicemail/);
});
