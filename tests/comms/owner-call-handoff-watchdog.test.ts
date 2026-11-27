import assert from "node:assert/strict";
import { test } from "vitest";

import {
  claimHandoffForCallback,
  handoffForCallback,
  resolveOwnerCallHandoff,
  staleRevisionRefusal,
  deliverOwnerCallHandoff,
  failStaleDeliveredHandoffs,
  handoffResult,
  OWNER_CALL_HANDOFF_LIMITS,
  ownerCallHandoffBody,
  ownerCallHandoffInstructions,
  verifyHandoffActed,
} from "@/lib/domain/comms/calls/owner-call-handoff";
import { voiceAgentOwnerCallInstructions } from "@/lib/domain/comms/calls/voice-agent-owner-call";
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
      "ownerCallHandoffRequest.count": 0,
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
      "ownerCallHandoffRequest.count": 0,
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
    "ownerCallHandoffRequest.count": 0,
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
      "ownerCallHandoffRequest.count": 0,
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
    "ownerCallHandoffRequest.count": 0,
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
    "ownerCallHandoffRequest.count": 0,
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
    "ownerCallHandoffRequest.count": 0,
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
    "agentCallEvent.count": 0,
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
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
    "handoff.callback_missed",
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
    "ownerCallHandoffRequest.count": 0,
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
    "ownerCallHandoffRequest.count": 0,
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.doesNotMatch(sent[0], /answered by voicemail/);
});

test("silent callback: one the owner picked up and said nothing on reopens the handoff it came from", async () => {
  const sent: string[] = [];
  const started: string[] = [];
  const silent = callbackRow();
  const call = silent.ownerCall.call as {
    recordings: unknown[];
    durationSeconds: number;
  };
  call.recordings = [];
  call.durationSeconds = 20;
  const recorder = recordingDb({
    "ownerCall.findUnique": { fromHandoffId: "h-src" },
    "ownerCallHandoff.findUnique": silent,
    "ownerCallHandoff.update": { ownerCallId: "oc-src" },
    "agentCallEvent.count": 0,
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
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
  assert.equal(outcome, "silent_callback");
  assert.deepEqual(sent, []);
  assert.deepEqual(started, ["h-src"]);
  const [closed] = writes(recorder.calls);
  assert.match(String(closed.data.resolution), /said nothing on this callback/);
  const [reopen] = ops(recorder.calls, "ownerCallHandoff.update");
  assert.match(
    String((reopen.args as { data: { lastError: string } }).data.lastError),
    /said nothing on it/,
  );
});

test("silent callback: a callback where the owner did speak is delivered as usual", async () => {
  const sent: string[] = [];
  const spoke = callbackRow();
  const call = spoke.ownerCall.call as {
    agentTranscript: string;
    recordings: unknown[];
  };
  call.agentTranscript = "Mili: Hi Raj.\nCaller: Yes, go ahead.";
  call.recordings = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": spoke,
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.equal(sent.length, 1);
});

// ── Review fixes (Sol) ──────────────────────────────────────────────────

test("a request saved while a close was being decided wins: nothing is closed over it", async () => {
  const silentShort = row(
    { requests: [] },
    {
      agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
      durationSeconds: 30,
    },
  );
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": silentShort,
    "ownerCallHandoff.updateMany": { count: 1 },
    // The call desk noted a request after the read above.
    "ownerCallHandoffRequest.count": 1,
  });
  const sent: string[] = [];
  assert.equal(await deliver(recorder, assistant("ok", sent)), "reopened");
  assert.deepEqual(sent, []);
  assert.deepEqual(writes(recorder.calls), []);

  const unheard = recordingDb({
    "ownerCall.findUnique": { fromHandoffId: "h-src" },
    "ownerCallHandoff.findUnique": callbackRow(),
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 1,
  });
  assert.equal(await deliver(unheard, assistant("ok", sent)), "reopened");
  assert.deepEqual(writes(unheard.calls), []);
  assert.deepEqual(ops(unheard.calls, "ownerCallHandoff.update"), []);
});

test("delivery: a recording transcript still pending is waited for, even when a live transcript exists", async () => {
  const pending = row(
    { requests: [] },
    {
      agentTranscript: "Mili: Hi Raj, it's Mili.",
      durationSeconds: 25,
      recordings: [{ transcript: null, transcriptStatus: "PENDING" }],
    },
  );
  const recorder = recordingDb({ "ownerCallHandoff.findUnique": pending });
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      { handoffId: "h-1", now: NOW, waitForTranscript: true },
      recorder.transactionalDb,
      { assistant: assistant("ok") },
    ),
    "waiting",
  );
  assert.deepEqual(writes(recorder.calls), []);
});

test("delivery: a recording transcript with no speaker labels cannot close a call as empty", async () => {
  const sent: string[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row(
      { requests: [] },
      {
        agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
        durationSeconds: 25,
        recordings: [
          {
            transcript: "hi raj call me back with the invoice please",
            transcriptStatus: "DONE",
          },
        ],
      },
    ),
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.equal(sent.length, 1);
});

test("delivery: reopened between the claim and the reread, it sends nothing with the void claim", async () => {
  let reads = 0;
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": () => {
      reads += 1;
      return reads === 1 ? row() : row({ revision: 1 });
    },
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  const sent: string[] = [];
  assert.equal(await deliver(recorder, assistant("ok", sent)), "reopened");
  assert.deepEqual(sent, []);
});

test("verify: a delivery newer than the check's own age is left alone", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": {
      deliveredAt: new Date(NOW.getTime() - 60_000),
      id: "h-1",
      ownerCall: { id: "oc-1" },
      revision: 3,
      status: "DELIVERED",
    },
  });
  assert.equal(
    await verifyHandoffActed(
      WORKFLOW,
      { final: true, handoffId: "h-1", now: NOW },
      recorder.transactionalDb,
    ),
    "skipped",
  );
  assert.deepEqual(writes(recorder.calls), []);
});

test("an owner who keeps missing the callback is not rung in a chain: the source fails and says so", async () => {
  const started: string[] = [];
  const recorder = recordingDb({
    "ownerCall.findUnique": { fromHandoffId: "h-src" },
    "ownerCallHandoff.findUnique": callbackRow(),
    "ownerCallHandoff.update": { ownerCallId: "oc-src" },
    // Four callbacks have already missed for this handoff.
    "agentCallEvent.count": 4,
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  await deliverOwnerCallHandoff(
    WORKFLOW,
    { handoffId: "h-1", now: NOW },
    recorder.transactionalDb,
    {
      assistant: assistant("never"),
      startDelivery: async (id) => {
        started.push(id);
      },
    },
  );
  assert.deepEqual(started, []);
  const failed = writes(recorder.calls).find(
    (w) => w.data.status === "FAILED" && w.where.id === "h-src",
  );
  assert.ok(failed);
  assert.equal(failed.data.attempts, OWNER_CALL_HANDOFF_LIMITS.maxAttempts);
  assert.match(String(failed.data.lastError), /did not get the callback/);
  assert.ok(eventKinds(recorder.calls).includes("handoff.failed"));
});

test("voicemail: a person saying they are not available is not a machine", async () => {
  const sent: string[] = [];
  const person = callbackRow();
  const call = person.ownerCall.call as {
    agentTranscript: string;
    recordings: unknown[];
  };
  call.agentTranscript =
    "Mili: Hi Raj.\nCaller: Sorry, I'm not available right now, can you call later?";
  call.recordings = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": person,
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.doesNotMatch(sent[0], /answered by voicemail/);
});

test("the RESULT marker: only a verdict at the very end counts, not one quoted mid-sentence", () => {
  assert.equal(
    handoffResult("I haven't reached RESULT: cannot yet. I'm still checking."),
    null,
  );
  assert.equal(handoffResult("Scheduled it. RESULT: scheduled"), "scheduled");
  assert.equal(
    handoffResult(
      "Done.\nRESULT: resolved (called resolve_owner_call_handoff)",
    ),
    "resolved",
  );
  assert.equal(
    handoffResult("Need a time. RESULT: needs_owner."),
    "needs_owner",
  );
});

// ── Second review ───────────────────────────────────────────────────────

test("a recording still pending means the owner's silence is not known: nothing is closed as empty", async () => {
  const sent: string[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row(
      { requests: [] },
      {
        agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
        durationSeconds: 25,
        recordings: [{ transcript: null, transcriptStatus: "PENDING" }],
      },
    ),
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  // Past the wait: it goes to Hermes, not closed.
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      {
        handoffId: "h-1",
        now: new Date(NOW.getTime() + 10 * 60_000),
        waitForTranscript: true,
      },
      recorder.transactionalDb,
      { assistant: assistant("ok", sent) },
    ),
    "delivered",
  );
  assert.equal(sent.length, 1);
});

test("a handoff with a saved request is not held back by a slow recording", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row(
      {},
      { recordings: [{ transcript: null, transcriptStatus: "PENDING" }] },
    ),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      { handoffId: "h-1", now: NOW, waitForTranscript: true },
      recorder.transactionalDb,
      { assistant: assistant("ok") },
    ),
    "delivered",
  );
});

test("a recording with only some lines labelled cannot show the owner said nothing", async () => {
  const sent: string[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row(
      { requests: [] },
      {
        agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
        durationSeconds: 25,
        recordings: [
          {
            transcript: "Mili: Hello\ncall me back about the invoice",
            transcriptStatus: "DONE",
          },
        ],
      },
    ),
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
});

test("voicemail: a person saying they were trying to reach you is not a machine", async () => {
  const sent: string[] = [];
  const person = callbackRow();
  const call = person.ownerCall.call as {
    agentTranscript: string;
    recordings: unknown[];
  };
  call.agentTranscript =
    "Mili: Hi Raj.\nCaller: I was trying to reach you earlier, what's up?";
  call.recordings = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": person,
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.doesNotMatch(sent[0], /answered by voicemail/);
});

test("the RESULT marker: markdown around it still counts, a quoted template does not", () => {
  assert.equal(
    handoffResult("Need the time.\n**RESULT: needs_owner**"),
    "needs_owner",
  );
  assert.equal(handoffResult("The template uses RESULT: cannot."), null);
});

test("verify: a check scheduled for one revision leaves a newer one alone", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": {
      deliveredAt: new Date(NOW.getTime() - 20 * 60_000),
      id: "h-1",
      ownerCall: { id: "oc-1" },
      revision: 2,
      status: "DELIVERED",
    },
  });
  assert.equal(
    await verifyHandoffActed(
      WORKFLOW,
      { expectedRevision: 1, final: true, handoffId: "h-1", now: NOW },
      recorder.transactionalDb,
    ),
    "skipped",
  );
  assert.deepEqual(writes(recorder.calls), []);
});

test("the body: a long answered call with no live transcript at all still warns that the words were lost", () => {
  const long = row(
    { requests: [] },
    { agentTranscript: null, durationSeconds: 116 },
  );
  const text = ownerCallHandoffBody(long as never, null);
  assert.match(text, /nothing the owner said/);
  assert.match(text, /RESULT: needs_owner/);
});

test("the call's instructions give the two-times rule whether or not Agent Factory can be asked", () => {
  const briefing = {
    agenda: ["One"],
    callId: "c",
    category: "other" as const,
    context: "ctx",
    eventAt: null,
    ownerName: "Raj",
    reference: null,
    subject: "s",
  };
  for (const canAskAssistant of [true, false]) {
    assert.match(
      voiceAgentOwnerCallInstructions(briefing, {
        canAskAssistant,
        caller: null,
      }),
      /give two options or the time is unclear/,
    );
  }
});

// ── Revisions (#646), newest first (#642), promised but unrecorded (#640) ──

test("resolving: a turn that read revision 0 cannot close a handoff reopened as revision 1", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row({ revision: 1, status: "DELIVERED" }),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  await assert.rejects(
    resolveOwnerCallHandoff(
      WORKFLOW,
      { expectedRevision: 0, handoffId: "h-1", resolution: "done", now: NOW },
      recorder.transactionalDb,
    ),
    (error: Error) => error.message === staleRevisionRefusal(1, 0),
  );
  assert.deepEqual(writes(recorder.calls), []);
  assert.deepEqual(eventKinds(recorder.calls), []);
});

test("resolving: the revision it read is closed, and the write is pinned to it", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row({
      resolution: "done",
      revision: 1,
      status: "RESOLVED",
    }),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  // Already resolved at the revision it read: returned as is.
  const done = await resolveOwnerCallHandoff(
    WORKFLOW,
    { expectedRevision: 1, handoffId: "h-1", resolution: "done", now: NOW },
    recorder.transactionalDb,
  );
  assert.equal(done.status, "RESOLVED");
  // A stale turn is not told a newer revision's resolution is its own.
  await assert.rejects(
    resolveOwnerCallHandoff(
      WORKFLOW,
      { expectedRevision: 0, handoffId: "h-1", resolution: "done", now: NOW },
      recorder.transactionalDb,
    ),
    (error: Error) => error.message === staleRevisionRefusal(1, 0),
  );

  const open = recordingDb({
    "ownerCallHandoff.findUnique": row({ revision: 1, status: "DELIVERED" }),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  await resolveOwnerCallHandoff(
    WORKFLOW,
    { expectedRevision: 1, handoffId: "h-1", resolution: "done", now: NOW },
    open.transactionalDb,
  );
  const [write] = writes(open.calls);
  assert.equal(write.where.revision, 1);
  assert.equal(write.data.status, "RESOLVED");
});

test("resolving: reopened between the check and the write, nothing is closed and the turn is told", async () => {
  let reads = 0;
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": () => {
      reads += 1;
      return reads === 1
        ? row({ revision: 1, status: "DELIVERED" })
        : row({ revision: 2, status: "PENDING" });
    },
    "ownerCallHandoff.updateMany": { count: 0 },
  });
  await assert.rejects(
    resolveOwnerCallHandoff(
      WORKFLOW,
      { expectedRevision: 1, handoffId: "h-1", resolution: "done", now: NOW },
      recorder.transactionalDb,
    ),
    (error: Error) => error.message === staleRevisionRefusal(2, 1),
  );
});

test("the callback: scheduled against a stale revision is refused, an existing callback is still returned, no revision is not checked", async () => {
  const stale = recordingDb({
    "ownerCallHandoff.findUnique": {
      callback: null,
      revision: 1,
      status: "DELIVERED",
    },
  });
  await assert.rejects(
    handoffForCallback(stale.db, "h-1", 0),
    (error: Error) => error.message === staleRevisionRefusal(1, 0),
  );
  const existing = recordingDb({
    "ownerCallHandoff.findUnique": {
      callback: { id: "oc-9" },
      revision: 1,
      status: "RESOLVED",
    },
  });
  assert.deepEqual(await handoffForCallback(existing.db, "h-1", 0), {
    existingCallbackId: "oc-9",
  });
  const unchecked = recordingDb({
    "ownerCallHandoff.findUnique": {
      callback: null,
      revision: 3,
      status: "DELIVERED",
    },
  });
  assert.deepEqual(await handoffForCallback(unchecked.db, "h-1"), {
    existingCallbackId: null,
  });
});

test("Hermes is told to pass the handoff's revision back", () => {
  const text = ownerCallHandoffInstructions("h-1", { revision: 2, why: null });
  assert.match(text, /handoff_revision 2/);
  assert.match(text, /get_owner_call_handoff/);
});

test("the body lists requests newest first and says the newest stands when they conflict", () => {
  const older = {
    callBack: true,
    createdAt: new Date(NOW.getTime() - 20_000),
    request: "Call back tomorrow.",
    source: "owner",
    timing: "tomorrow",
  };
  const newer = {
    callBack: true,
    createdAt: NOW,
    request: "Call back in five minutes.",
    source: "owner",
    timing: "in five minutes",
  };
  const both = row({ requests: [older, newer] });
  const text = ownerCallHandoffBody(
    both as never,
    both.ownerCall.call.agentTranscript,
  );
  assert.ok(text.indexOf("1. Call back in five minutes") > 0);
  assert.ok(
    text.indexOf("2. Call back tomorrow") > text.indexOf("1. Call back"),
  );
  assert.match(text, /newest first; if they conflict/);
  const single = row();
  assert.doesNotMatch(
    ownerCallHandoffBody(
      single as never,
      single.ownerCall.call.agentTranscript,
    ),
    /newest first/,
  );
});

test("a promise Mili made with nothing recorded is flagged, and the call is not closed as empty", async () => {
  const promised = row(
    { requests: [] },
    {
      agentTranscript:
        "Mili: Hi Raj, it's Mili. Have you got a minute?\nMili: Sure, I'll pass that on to Agent Factory.",
      durationSeconds: 30,
    },
  );
  const text = ownerCallHandoffBody(
    promised as never,
    promised.ownerCall.call.agentTranscript,
  );
  assert.match(text, /told the owner she would pass something on or call back/);

  const sent: string[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": promised,
    "ownerCallHandoff.updateMany": { count: 1 },
    "ownerCallHandoffRequest.count": 0,
  });
  assert.equal(await deliver(recorder, assistant("ok", sent)), "delivered");
  assert.match(sent[0], /told the owner she would pass something on/);

  // Nothing promised, nothing said: still closed.
  const quiet = row(
    { requests: [] },
    {
      agentTranscript: "Mili: Hi Raj, it's Mili. Have you got a minute?",
      durationSeconds: 30,
    },
  );
  assert.doesNotMatch(
    ownerCallHandoffBody(quiet as never, quiet.ownerCall.call.agentTranscript),
    /told the owner she would pass/,
  );
});

test("a promise: Mili's own commitments count, a quoted third party and an ordinary answer do not", async () => {
  const bodyFor = (milisLine: string) => {
    const r = row(
      { requests: [] },
      {
        agentTranscript: `Mili: Hi Raj.\nMili: ${milisLine}`,
        durationSeconds: 30,
      },
    );
    return ownerCallHandoffBody(r as never, r.ownerCall.call.agentTranscript);
  };
  const flagged = /told the owner she would pass something on or call back/;
  for (const line of [
    "I'll pass your invoice request to Agent Factory.",
    "Sure, I'll have Agent Factory call you back with the details.",
    "We will get back to you tomorrow.",
  ]) {
    assert.match(bodyFor(line), flagged, line);
  }
  for (const line of [
    "The supplier said, 'I'll get back to you Friday'.",
    "Your inspection is on Tuesday at 9:30.",
  ]) {
    assert.doesNotMatch(bodyFor(line), flagged, line);
  }
});

test("a promise found only in the recording also warns, not just closes nothing", () => {
  const r = row(
    { requests: [] },
    {
      agentTranscript: "Mili: Hi Raj.",
      durationSeconds: 30,
      recordings: [
        {
          transcript:
            "Mili: Hi Raj.\nCaller: call me back about the bookings\nMili: Of course, I'll call you back with them.",
          transcriptStatus: "DONE",
        },
      ],
    },
  );
  assert.match(
    ownerCallHandoffBody(r as never, r.ownerCall.call.agentTranscript),
    /told the owner she would pass something on or call back/,
  );
});

test("a request the owner changed is touched to the newest, and requests tie-break deterministically", async () => {
  // Pinned through the update the call desk's second note performs.
  const { noteOwnerCallRequest } =
    await import("@/lib/domain/comms/calls/owner-call-handoff");
  const recorder = recordingDb({
    "call.findUnique": {
      direction: "OUTBOUND",
      ownerCall: { id: "oc-1" },
      providerCallId: "v3:abc",
      staffTarget: "AGENT",
    },
    "ownerCallHandoff.createMany": { count: 0 },
    "ownerCallHandoff.findUnique": { id: "h-1", status: "OPEN" },
    "ownerCallHandoffRequest.findUnique": {
      callBack: true,
      id: "r-1",
      timing: "tomorrow",
    },
  });
  await noteOwnerCallRequest(
    { callId: "call-1", kind: "voice-call", providerCallId: "v3:abc" },
    {
      callBack: true,
      now: NOW,
      request: "Call me back.",
      source: "owner",
      timing: "in five minutes",
    },
    recorder.transactionalDb,
  );
  const [update] = ops(recorder.calls, "ownerCallHandoffRequest.update");
  assert.deepEqual(
    (update.args as { data: { createdAt: Date } }).data.createdAt,
    NOW,
  );
});

// ── Late notes on a PENDING handoff (#650) and stale callbacks (#649) ──────

test("delivery: a note that landed on the PENDING handoff before the claim is sent, as the new revision", async () => {
  let reads = 0;
  let claimId: unknown = null;
  const sent: string[] = [];
  const instructions: string[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": () => {
      reads += 1;
      // The first read, then the reread after the claim: a note bumped the
      // revision and the claim is still ours (DELIVERING, our claim id).
      return reads === 1
        ? row()
        : row({ claimId, revision: 1, status: "DELIVERING" });
    },
    "ownerCallHandoff.updateMany": (args: unknown) => {
      const data = (args as { data: { claimId?: unknown } }).data;
      if (data.claimId) claimId = data.claimId;
      return { count: 1 };
    },
  });
  const port: OwnerAssistantPort = {
    ask: async () => "",
    handOff: async (handoff) => {
      sent.push(handoff.body);
      instructions.push(handoff.instructions);
      return "Done. RESULT: scheduled";
    },
  };
  assert.equal(await deliver(recorder, port), "delivered");
  assert.equal(sent.length, 1);
  assert.match(instructions[0], /Handoff id: h-1, revision 1/);
  // The claim is not pinned to the revision, so the bump cannot make it miss.
  const [claim] = writes(recorder.calls);
  assert.equal(claim.data.status, "DELIVERING");
  assert.equal("revision" in claim.where, false);
});

const callbackFor = (
  overrides: Record<string, unknown> = {},
  handoff: Record<string, unknown> = {},
) => ({
  callback: {
    fromHandoffRevision: 0,
    id: "oc-old",
    status: "SCHEDULED",
    ...overrides,
  },
  revision: 1,
  status: "DELIVERED",
  ...handoff,
});

test("a callback booked for an older revision that has not rung is replaced when the newer one asks", async () => {
  const pre = recordingDb({
    "ownerCallHandoff.findUnique": callbackFor(),
  });
  assert.deepEqual(await handoffForCallback(pre.db, "h-1", 1), {
    existingCallbackId: null,
  });

  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": callbackFor(),
    "ownerCall.updateMany": { count: 1 },
  });
  assert.deepEqual(
    await claimHandoffForCallback(recorder.transactionalDb, "h-1", 1),
    { existingCallbackId: null },
  );
  const [cancel] = ops(recorder.calls, "ownerCall.updateMany");
  const args = cancel.args as {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  };
  assert.equal(args.data.status, "CANCELED");
  assert.equal(args.data.fromHandoffId, null);
  assert.equal(args.where.id, "oc-old");
  assert.equal(args.where.status, "SCHEDULED");
  assert.deepEqual(eventKinds(recorder.calls), ["owner_call.canceled"]);
});

test("a callback for an older revision that has rung cannot be replaced; one being placed is a retry, not a refusal to separate", async () => {
  const placed = recordingDb({
    "ownerCallHandoff.findUnique": callbackFor({ status: "PLACED" }),
  });
  await assert.rejects(
    handoffForCallback(placed.db, "h-1", 1),
    (error: Error) => /has rung, or may have/.test(error.message),
  );
  // PLACING only means a timer claimed it: it can be put back to SCHEDULED
  // (Mili busy) and ring later, so Hermes must not be sent to schedule a
  // separate call yet.
  const placing = recordingDb({
    "ownerCallHandoff.findUnique": callbackFor({ status: "PLACING" }),
  });
  await assert.rejects(
    handoffForCallback(placing.db, "h-1", 1),
    (error: Error) =>
      /being placed right now/.test(error.message)
      && /Do not schedule a separate call/.test(error.message),
  );
  // It was claimed between the check and the cancel: the same retry.
  const raced = recordingDb({
    "ownerCallHandoff.findUnique": callbackFor(),
    "ownerCall.updateMany": { count: 0 },
  });
  await assert.rejects(
    claimHandoffForCallback(raced.transactionalDb, "h-1", 1),
    (error: Error) => /being placed right now/.test(error.message),
  );
  assert.deepEqual(eventKinds(raced.calls), []);
});

test("a cancelled callback for an older revision is replaced by unlinking it; a FAILED one still attached may have rung and is not", async () => {
  const failed = recordingDb({
    "ownerCallHandoff.findUnique": callbackFor({ status: "FAILED" }),
  });
  await assert.rejects(
    handoffForCallback(failed.db, "h-1", 1),
    (error: Error) => /rung, or may have/.test(error.message),
  );
  for (const status of ["CANCELED"]) {
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": callbackFor({ status }),
      "ownerCall.updateMany": (args: unknown) =>
        (args as { data: { status?: string } }).data.status
          ? { count: 0 }
          : { count: 1 },
    });
    assert.deepEqual(
      await claimHandoffForCallback(recorder.transactionalDb, "h-1", 1),
      { existingCallbackId: null },
    );
    const unlink = ops(recorder.calls, "ownerCall.updateMany")[1].args as {
      data: Record<string, unknown>;
    };
    assert.deepEqual(unlink.data, { fromHandoffId: null });
  }
});

test("a handoff already resolved without a callback, or still on the call, is not given one by replacing", async () => {
  for (const [status, message] of [
    ["RESOLVED", /already resolved without a callback/],
    ["OPEN", /still going/],
  ] as const) {
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": callbackFor({}, { status }),
    });
    await assert.rejects(
      handoffForCallback(recorder.db, "h-1", 1),
      (error: Error) => message.test(error.message),
    );
  }
});

test("a delivery: a stale worker cannot take over a fresh attempt's claim, nor send under another worker's", async () => {
  // The claim pins the claim id it observed.
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": row({
      claimId: "claim-seen",
      status: "FAILED",
    }),
    "ownerCallHandoff.updateMany": { count: 0 },
  });
  assert.equal(await deliver(recorder, assistant("never")), "skipped");
  const [claim] = writes(recorder.calls);
  assert.equal(claim.where.claimId, "claim-seen");

  // The reread shows another worker's claim: ours was taken over, nothing sent.
  let reads = 0;
  const sent: string[] = [];
  const other = recordingDb({
    "ownerCallHandoff.findUnique": () => {
      reads += 1;
      return reads === 1
        ? row()
        : row({ claimId: "someone-else", status: "DELIVERING" });
    },
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(await deliver(other, assistant("never", sent)), "skipped");
  assert.deepEqual(sent, []);
});

test("a delivery reports the revision it actually sent", async () => {
  let reads = 0;
  let claimId: unknown = null;
  let sentRevision: number | null = null;
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": () => {
      reads += 1;
      return reads === 1
        ? row()
        : row({ claimId, revision: 3, status: "DELIVERING" });
    },
    "ownerCallHandoff.updateMany": (args: unknown) => {
      const data = (args as { data: { claimId?: unknown } }).data;
      if (data.claimId) claimId = data.claimId;
      return { count: 1 };
    },
  });
  const outcome = await deliverOwnerCallHandoff(
    WORKFLOW,
    { handoffId: "h-1", now: NOW },
    recorder.transactionalDb,
    {
      assistant: assistant("ok"),
      onDelivered: (sent) => {
        sentRevision = sent.revision;
      },
    },
  );
  assert.equal(outcome, "delivered");
  assert.equal(sentRevision, 3);
});

test('a promise: a refusal like "I will not be able to call you back" is not a promise', () => {
  const bodyFor = (milisLine: string) => {
    const r = row(
      { requests: [] },
      {
        agentTranscript: `Mili: Hi Raj.\nMili: ${milisLine}`,
        durationSeconds: 30,
      },
    );
    return ownerCallHandoffBody(r as never, r.ownerCall.call.agentTranscript);
  };
  const flagged = /told the owner she would pass something on or call back/;
  assert.doesNotMatch(bodyFor("I will not be able to call you back."), flagged);
  assert.doesNotMatch(bodyFor("I can't call you back today."), flagged);
  assert.match(bodyFor("I'll ask the team to call you back."), flagged);
});

test("an existing callback still answers the same revision, a legacy callback and a request with no revision", async () => {
  for (const [callback, expected] of [
    [{ fromHandoffRevision: 1 }, 1],
    [{ fromHandoffRevision: null }, 1],
    [{ fromHandoffRevision: 0 }, undefined],
  ] as const) {
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": callbackFor(callback),
    });
    assert.deepEqual(await handoffForCallback(recorder.db, "h-1", expected), {
      existingCallbackId: "oc-old",
    });
  }
});

test("a stale turn is refused even when a callback for an older revision exists", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": callbackFor({}, { revision: 2 }),
  });
  await assert.rejects(
    handoffForCallback(recorder.db, "h-1", 1),
    (error: Error) => error.message === staleRevisionRefusal(2, 1),
  );
});

test('a promise: "I\'ll ask the team to call you back" counts', () => {
  const r = row(
    { requests: [] },
    {
      agentTranscript:
        "Mili: Hi Raj.\nMili: Of course, I'll ask the team to call you back.",
      durationSeconds: 30,
    },
  );
  assert.match(
    ownerCallHandoffBody(r as never, r.ownerCall.call.agentTranscript),
    /told the owner she would pass something on or call back/,
  );
});
