import assert from "node:assert/strict";
import { test } from "vitest";

import { parseLookupCall } from "@/lib/comms/voice-agent/desk";
import {
  deliverOwnerCallHandoff,
  markOwnerCallEnded,
  noteOwnerCallRequest,
  OWNER_CALL_HANDOFF_LIMITS,
  OWNER_CALL_HANDOFF_REFUSALS,
  ownerCallHandoffBody,
  resolveOwnerCallHandoff,
} from "@/lib/domain/comms/calls/owner-call-handoff";
import {
  OWNER_CALL_REFUSALS,
  placeOwnerCall,
  requestOwnerCall,
} from "@/lib/domain/comms/calls/owner-call";
import {
  DomainNotFoundError,
  DomainTransitionError,
} from "@/lib/domain/errors";
import type {
  OwnerAssistantHandoff,
  OwnerAssistantPort,
} from "@/lib/domain/ports/owner-assistant";
import { systemPrincipal } from "@/lib/domain/principal";
import { chatCompletionsUrl, hermesAssistant } from "@/lib/hermes/assistant";

import { recordingDb } from "../architecture/domain-harness";

// What an owner call leaves for Hermes once it ends. Noted on the call so a
// dying session keeps it; made ready once however many end-of-call events
// arrive; delivered by a claim so two runs send it once; every failure kept
// as outstanding, never reported as delivered; and the callback Hermes
// schedules from it rings once, and reopens it if it fails to ring.

const NOW = new Date("2026-11-26T02:00:00Z");
const HERMES = systemPrincipal("hermes");
const WORKFLOW = systemPrincipal("workflow:owner-call-handoff");
const AUTHORITY = { callId: "call-1", providerCallId: "v3:abc" } as never;

type Op = { operation: string; args: unknown };
const ops = (calls: readonly Op[], operation: string) =>
  calls.filter((c) => c.operation === operation);
const eventKinds = (calls: readonly Op[]) =>
  ops(calls, "agentCallEvent.create").map(
    (c) => (c.args as { data: { kind: string } }).data.kind,
  );

const VOICE_ROW = {
  direction: "OUTBOUND",
  ownerCall: { id: "oc-1" },
  providerCallId: "v3:abc",
  staffTarget: "AGENT",
};

function handoffRow(overrides: Record<string, unknown> = {}) {
  return {
    attempts: 0,
    callback: null,
    deliveredAt: null,
    hermesReply: null,
    id: "h-1",
    lastAttemptAt: null,
    lastError: null,
    ownerCall: {
      call: {
        agentTranscript:
          "Raj: Can you check the last two building bookings?\nMili: Would you like to hold, or shall I have Hermes call you back?\nRaj: Call me back.",
        answeredAt: NOW,
        answeredBy: "AGENT",
        durationSeconds: 95,
        endedAt: NOW,
        id: "call-1",
        recordings: [],
        startedAt: NOW,
        status: "COMPLETED",
      },
      category: "task_update",
      id: "oc-1",
      reference: "task-9",
      subject: "Bookings update",
    },
    readyAt: NOW,
    requests: [
      {
        callBack: true,
        createdAt: NOW,
        request: "Find the past two building bookings and call back with them.",
        source: "owner",
        timing: null,
      },
    ],
    resolution: null,
    resolvedAt: null,
    status: "PENDING",
    ...overrides,
  };
}

function assistant(
  handOff: OwnerAssistantPort["handOff"] = async () => "On it.",
): OwnerAssistantPort {
  return { ask: async () => "", handOff };
}

// ── On the call ─────────────────────────────────────────────────────────

test("on the call: a request is noted at once on the call's handoff, with an event", async () => {
  const recorder = recordingDb({
    "call.findUnique": VOICE_ROW,
    "ownerCallHandoff.findUnique": { id: "h-1", status: "OPEN" },
    "ownerCallHandoffRequest.count": 0,
    "ownerCallHandoffRequest.createMany": { count: 1 },
  });
  const noted = await noteOwnerCallRequest(
    AUTHORITY,
    {
      callBack: true,
      now: NOW,
      request: "  Find the past two   building bookings. ",
      source: "owner",
      timing: "after three",
    },
    recorder.transactionalDb,
  );
  assert.deepEqual(noted, { alreadyNoted: false, handoffId: "h-1" });
  const created = ops(recorder.calls, "ownerCallHandoff.createMany")[0]
    ?.args as { data: { status: string }[]; skipDuplicates: boolean };
  assert.equal(created.data[0].status, "OPEN");
  assert.equal(created.skipDuplicates, true, "one handoff per owner call");
  const request = ops(recorder.calls, "ownerCallHandoffRequest.createMany")[0]
    ?.args as { data: Record<string, unknown>[]; skipDuplicates: boolean };
  assert.equal(request.data[0].request, "Find the past two building bookings.");
  assert.equal(request.data[0].callBack, true);
  assert.equal(request.data[0].timing, "after three");
  assert.equal(request.skipDuplicates, true);
  assert.deepEqual(eventKinds(recorder.calls), ["handoff.noted"]);
});

test("on the call: the same request noted twice is kept once, and logged once", async () => {
  const recorder = recordingDb({
    "call.findUnique": VOICE_ROW,
    "ownerCallHandoff.findUnique": { id: "h-1", status: "OPEN" },
    "ownerCallHandoffRequest.count": 1,
    "ownerCallHandoffRequest.createMany": { count: 0 },
  });
  const noted = await noteOwnerCallRequest(
    AUTHORITY,
    { callBack: true, request: "Call me back", source: "owner" },
    recorder.transactionalDb,
  );
  assert.equal(noted.alreadyNoted, true);
  assert.deepEqual(eventKinds(recorder.calls), []);
});

test("on the call: another call's stream, or a call that isn't an owner call, notes nothing", async () => {
  for (const row of [
    { ...VOICE_ROW, providerCallId: "v3:other" },
    { ...VOICE_ROW, ownerCall: null },
    { ...VOICE_ROW, direction: "INBOUND" },
    null,
  ]) {
    const recorder = recordingDb({ "call.findUnique": row });
    await assert.rejects(
      noteOwnerCallRequest(
        AUTHORITY,
        { callBack: false, request: "Book the plumber", source: "owner" },
        recorder.transactionalDb,
      ),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.operations(), ["call.findUnique"]);
  }
});

test("on the call: a desk that keeps noting is capped", async () => {
  const recorder = recordingDb({
    "call.findUnique": VOICE_ROW,
    "ownerCallHandoff.findUnique": { id: "h-1", status: "OPEN" },
    "ownerCallHandoffRequest.count": OWNER_CALL_HANDOFF_LIMITS.requestsPerCall,
  });
  await assert.rejects(
    noteOwnerCallRequest(
      AUTHORITY,
      { callBack: false, request: "One more", source: "owner" },
      recorder.transactionalDb,
    ),
    DomainTransitionError,
  );
});

test("the call desk's hand_to_hermes parses, and a request without call_back does not", () => {
  assert.deepEqual(
    parseLookupCall("hand_to_hermes", {
      call_back: true,
      request: "Check the bookings",
      timing: "after 3",
    }),
    {
      call_back: true,
      name: "hand_to_hermes",
      request: "Check the bookings",
      timing: "after 3",
    },
  );
  assert.equal(
    parseLookupCall("hand_to_hermes", { request: "Check the bookings" }),
    null,
  );
});

// ── The call ends ───────────────────────────────────────────────────────

test("the call ends: its handoff is ready once, however many end-of-call events arrive", async () => {
  const first = recordingDb({
    "ownerCall.findUnique": { id: "oc-1" },
    "ownerCallHandoff.findUnique": { id: "h-1", status: "OPEN" },
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await markOwnerCallEnded(first.db, { callId: "call-1", now: NOW }),
    "h-1",
  );
  const moved = ops(first.calls, "ownerCallHandoff.updateMany")[0]?.args as {
    data: { status: string };
    where: { status: string };
  };
  assert.equal(moved.where.status, "OPEN");
  assert.equal(moved.data.status, "PENDING");
  assert.deepEqual(eventKinds(first.calls), ["handoff.ready"]);

  // Mili's report and then the carrier's last status: the second does nothing.
  const repeat = recordingDb({
    "ownerCall.findUnique": { id: "oc-1" },
    "ownerCallHandoff.findUnique": { id: "h-1", status: "PENDING" },
    "ownerCallHandoff.updateMany": { count: 0 },
  });
  assert.equal(
    await markOwnerCallEnded(repeat.db, { callId: "call-1", now: NOW }),
    null,
  );
  assert.deepEqual(eventKinds(repeat.calls), []);

  const notOwner = recordingDb({ "ownerCall.findUnique": null });
  assert.equal(
    await markOwnerCallEnded(notOwner.db, { callId: "call-9", now: NOW }),
    null,
  );
  assert.deepEqual(notOwner.operations(), ["ownerCall.findUnique"]);
});

// ── Delivery ────────────────────────────────────────────────────────────

test("delivery: Hermes is told what to do, with the requests and the transcript as data, and it is DELIVERED", async () => {
  const sent: OwnerAssistantHandoff[] = [];
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow(),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  const outcome = await deliverOwnerCallHandoff(
    WORKFLOW,
    { handoffId: "h-1", now: NOW, waitForTranscript: true },
    recorder.transactionalDb,
    {
      assistant: assistant(async (handoff) => {
        sent.push(handoff);
        return "I'll find the two bookings and schedule the callback.";
      }),
    },
  );
  assert.equal(outcome, "delivered");
  const handoff = sent[0];
  assert.equal(handoff.handoffId, "h-1");
  assert.equal(handoff.reference, "task-9");
  assert.match(handoff.instructions, /Handoff id: h-1/);
  assert.match(handoff.instructions, /schedule_owner_call with handoff_id/);
  assert.match(handoff.instructions, /Never guess a time/);
  assert.match(
    handoff.body,
    /1\. Find the past two building bookings and call back with them\. \(call_back: yes\)/,
  );
  assert.match(handoff.body, /The owner picked up/);
  assert.match(handoff.body, /Raj: Call me back\./);

  const writes = ops(recorder.calls, "ownerCallHandoff.updateMany").map(
    (c) =>
      c.args as {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      },
  );
  // Claimed first, so a second run finds nothing to send.
  assert.equal(writes[0].data.status, "DELIVERING");
  assert.equal(writes[0].where.status, "PENDING");
  // Only a DELIVERING claim becomes DELIVERED: one Hermes resolved while
  // answering (it scheduled the callback inside the request) stays resolved.
  assert.equal(writes[1].data.status, "DELIVERED");
  assert.equal(writes[1].where.status, "DELIVERING");
  assert.deepEqual(eventKinds(recorder.calls), ["handoff.delivered"]);
});

test("delivery: Hermes failing leaves it FAILED and outstanding, with why — never delivered", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow(),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  const outcome = await deliverOwnerCallHandoff(
    WORKFLOW,
    { handoffId: "h-1", now: NOW },
    recorder.transactionalDb,
    {
      assistant: assistant(async () => {
        throw new Error("Hermes answered 502 to a chat completion.");
      }),
    },
  );
  assert.equal(outcome, "failed");
  const writes = ops(recorder.calls, "ownerCallHandoff.updateMany").map(
    (c) => c.args as { data: Record<string, unknown> },
  );
  assert.equal(writes.at(-1)?.data.status, "FAILED");
  assert.match(String(writes.at(-1)?.data.lastError), /502/);
  assert.deepEqual(eventKinds(recorder.calls), ["handoff.failed"]);

  // Out of tries on this one: given up, still FAILED for the office.
  const last = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow({
      attempts: OWNER_CALL_HANDOFF_LIMITS.maxAttempts - 1,
      status: "FAILED",
    }),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      { handoffId: "h-1", now: NOW },
      last.transactionalDb,
      {
        assistant: assistant(async () => {
          throw new Error("timeout");
        }),
      },
    ),
    "gave_up",
  );
});

test("delivery: Hermes not connected — kept outstanding for Hermes to pull, and the try counted", async () => {
  const recorder = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow(),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      { handoffId: "h-1", now: NOW },
      recorder.transactionalDb,
      { assistant: null },
    ),
    "unavailable",
  );
  const write = ops(recorder.calls, "ownerCallHandoff.updateMany")[0]?.args as {
    data: Record<string, unknown>;
  };
  assert.equal(write.data.status, "FAILED");
  assert.equal(write.data.lastError, OWNER_CALL_HANDOFF_REFUSALS.notConnected);
  assert.deepEqual(write.data.attempts, { increment: 1 });
});

test("delivery: an answered call whose transcript hasn't landed waits for it, then goes without", async () => {
  const noTranscript = handoffRow();
  (
    noTranscript.ownerCall.call as { agentTranscript: string | null }
  ).agentTranscript = null;
  let sent = 0;
  const waiting = recordingDb({
    "ownerCallHandoff.findUnique": noTranscript,
  });
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      { handoffId: "h-1", now: NOW, waitForTranscript: true },
      waiting.transactionalDb,
      {
        assistant: assistant(async () => {
          sent += 1;
          return "ok";
        }),
      },
    ),
    "waiting",
  );
  assert.equal(sent, 0);
  assert.deepEqual(ops(waiting.calls, "ownerCallHandoff.updateMany"), []);

  // Past the wait, or told not to: sent, saying no transcript was kept.
  const bodies: string[] = [];
  const late = recordingDb({
    "ownerCallHandoff.findUnique": noTranscript,
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      {
        handoffId: "h-1",
        now: new Date(
          NOW.getTime()
            + (OWNER_CALL_HANDOFF_LIMITS.transcriptWaitMinutes + 1) * 60_000,
        ),
        waitForTranscript: true,
      },
      late.transactionalDb,
      {
        assistant: assistant(async (handoff) => {
          bodies.push(handoff.body);
          return "ok";
        }),
      },
    ),
    "delivered",
  );
  assert.match(bodies[0], /No transcript was kept for this call\./);
  // The noted request still goes: it was written on the call, not taken from
  // the transcript.
  assert.match(bodies[0], /Find the past two building bookings/);
});

test("delivery: nothing is sent twice — resolved, already delivered, or a claim another run won", async () => {
  for (const status of ["RESOLVED", "DELIVERED", "OPEN"]) {
    let sent = 0;
    const recorder = recordingDb({
      "ownerCallHandoff.findUnique": handoffRow({ status }),
    });
    assert.equal(
      await deliverOwnerCallHandoff(
        WORKFLOW,
        { handoffId: "h-1", now: NOW },
        recorder.transactionalDb,
        {
          assistant: assistant(async () => {
            sent += 1;
            return "";
          }),
        },
      ),
      "skipped",
    );
    assert.equal(sent, 0);
  }
  let sent = 0;
  const lost = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow(),
    "ownerCallHandoff.updateMany": { count: 0 },
  });
  assert.equal(
    await deliverOwnerCallHandoff(
      WORKFLOW,
      { handoffId: "h-1", now: NOW },
      lost.transactionalDb,
      {
        assistant: assistant(async () => {
          sent += 1;
          return "";
        }),
      },
    ),
    "skipped",
  );
  assert.equal(sent, 0);
});

test("the body: an unanswered call, nothing noted, and a question Hermes couldn't answer on hold each say so", () => {
  const row = handoffRow({
    requests: [],
  }) as unknown as Parameters<typeof ownerCallHandoffBody>[0];
  const unanswered = {
    ...row,
    ownerCall: {
      ...row.ownerCall,
      call: {
        ...row.ownerCall.call!,
        answeredAt: null,
        answeredBy: null,
        status: "NO_ANSWER" as const,
      },
    },
  };
  const body = ownerCallHandoffBody(unanswered, null);
  assert.match(body, /The owner didn't pick up\./);
  assert.match(body, /None were noted on the call\. Read the transcript/);

  const held = ownerCallHandoffBody(
    {
      ...row,
      requests: [
        {
          callBack: true,
          createdAt: NOW,
          request: "Who's at the inspection?",
          source: "hold_failed",
          timing: null,
        },
      ],
    },
    "…",
  );
  assert.match(held, /they held for this and you couldn't answer on the call/);
});

// ── Hermes dealing with it ──────────────────────────────────────────────

test("resolving: refused while the call is still on; recorded once; repeating it changes nothing", async () => {
  const open = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow({ status: "OPEN" }),
  });
  await assert.rejects(
    resolveOwnerCallHandoff(
      HERMES,
      { handoffId: "h-1", resolution: "Sent by text" },
      open.transactionalDb,
    ),
    DomainTransitionError,
  );

  const outstanding = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow({ status: "DELIVERED" }),
    "ownerCallHandoff.updateMany": { count: 1 },
  });
  await resolveOwnerCallHandoff(
    HERMES,
    { handoffId: "h-1", now: NOW, resolution: "Texted Raj the two bookings." },
    outstanding.transactionalDb,
  );
  const moved = ops(outstanding.calls, "ownerCallHandoff.updateMany")[0]
    ?.args as { data: Record<string, unknown> };
  assert.equal(moved.data.status, "RESOLVED");
  assert.deepEqual(eventKinds(outstanding.calls), ["handoff.resolved"]);

  const done = recordingDb({
    "ownerCallHandoff.findUnique": handoffRow({ status: "RESOLVED" }),
  });
  await resolveOwnerCallHandoff(
    HERMES,
    { handoffId: "h-1", resolution: "again" },
    done.transactionalDb,
  );
  assert.deepEqual(ops(done.calls, "ownerCallHandoff.updateMany"), []);
});

const CALLBACK_INPUT = {
  agenda: ["The two most recent building bookings"],
  callAt: new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
  category: "task_update",
  context: "Framing crew 2 Dec; roof plumber 4 Dec.",
  handoffId: "h-1",
  idempotencyKey: "handoff:h-1",
  now: NOW,
  subject: "Your two building bookings",
};

const OWNER_LINE = {
  createdAt: NOW,
  e164: "+61411111111",
  id: "owner",
  nickname: "Raj",
  updatedAt: NOW,
};

function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    call: null,
    callAt: CALLBACK_INPUT.callAt,
    canceledAt: null,
    category: "task_update",
    createdAt: NOW,
    eventAt: null,
    failureReason: null,
    fromHandoffId: "h-1",
    handoff: null,
    id,
    placedAt: null,
    questionsAsked: 0,
    reference: null,
    source: "hermes",
    status: "SCHEDULED",
    subject: "Your two building bookings",
    ...overrides,
  };
}

test("the callback: scheduled with the handoff's id it resolves the handoff in the same transaction", async () => {
  const recorder = recordingDb({
    "agentCallEvent.create": {},
    "commsOwnerLine.findUnique": OWNER_LINE,
    "ownerCall.create": { id: "oc-2" },
    "ownerCall.findUnique": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      return where.idempotencyKey ? null : summary("oc-2");
    },
    "ownerCallHandoff.findUnique": { callback: null, status: "DELIVERED" },
    "ownerCallHandoff.update": { ownerCallId: "oc-1" },
  });
  const result = await requestOwnerCall(
    HERMES,
    CALLBACK_INPUT,
    recorder.transactionalDb,
  );
  assert.equal(result.alreadyRequested, false);
  const created = ops(recorder.calls, "ownerCall.create")[0]?.args as {
    data: Record<string, unknown>;
  };
  assert.equal(created.data.fromHandoffId, "h-1");
  const resolved = ops(recorder.calls, "ownerCallHandoff.update")[0]?.args as {
    data: Record<string, unknown>;
  };
  assert.equal(resolved.data.status, "RESOLVED");
  assert.match(String(resolved.data.resolution), /Callback scheduled for/);
  // Both in the request's one transaction: the order between them is not
  // the point.
  assert.deepEqual(eventKinds(recorder.calls).sort(), [
    "handoff.resolved",
    "owner_call.scheduled",
  ]);
});

test("the callback: a handoff Hermes received twice still gets one callback", async () => {
  const recorder = recordingDb({
    "ownerCall.findUnique": (args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      return where.idempotencyKey ? null : summary("oc-2");
    },
    "ownerCallHandoff.findUnique": {
      callback: { id: "oc-2" },
      status: "RESOLVED",
    },
  });
  const result = await requestOwnerCall(
    HERMES,
    { ...CALLBACK_INPUT, idempotencyKey: "a-different-key" },
    recorder.transactionalDb,
  );
  assert.equal(result.alreadyRequested, true);
  assert.equal(result.ownerCall.id, "oc-2");
  assert.deepEqual(ops(recorder.calls, "ownerCall.create"), []);
});

test("the callback: refused while the call it came from is still on, and for a handoff that isn't there", async () => {
  const open = recordingDb({
    "ownerCall.findUnique": null,
    "ownerCallHandoff.findUnique": { callback: null, status: "OPEN" },
  });
  await assert.rejects(
    requestOwnerCall(HERMES, CALLBACK_INPUT, open.transactionalDb),
    DomainTransitionError,
  );
  const missing = recordingDb({
    "ownerCall.findUnique": null,
    "ownerCallHandoff.findUnique": null,
  });
  await assert.rejects(
    requestOwnerCall(HERMES, CALLBACK_INPUT, missing.transactionalDb),
    DomainNotFoundError,
  );
});

test("the callback failing to ring reopens its handoff, unlinked so Hermes can schedule another", async () => {
  const recorder = recordingDb({
    "agentCallEvent.create": {},
    "commsOwnerLine.findUnique": null,
    "ownerCall.findUnique": {
      callAt: NOW,
      category: "task_update",
      fromHandoffId: "h-1",
    },
    "ownerCall.updateMany": { count: 1 },
    "ownerCallHandoff.update": { ownerCallId: "oc-1" },
  });
  assert.equal(
    await placeOwnerCall(
      systemPrincipal("workflow:owner-call"),
      { now: NOW, ownerCallId: "oc-2" },
      recorder.transactionalDb,
    ),
    "failed",
  );
  const unlinked = ops(recorder.calls, "ownerCall.update").find(
    (c) => "fromHandoffId" in (c.args as { data: object }).data,
  );
  assert.ok(unlinked, "the failed call no longer holds the handoff's callback");
  const reopened = ops(recorder.calls, "ownerCallHandoff.update")[0]?.args as {
    data: Record<string, unknown>;
    where: { id: string };
  };
  assert.equal(reopened.where.id, "h-1");
  assert.equal(reopened.data.status, "PENDING");
  assert.match(
    String(reopened.data.lastError),
    new RegExp(OWNER_CALL_REFUSALS.noLine.slice(0, 20)),
  );
  assert.deepEqual(eventKinds(recorder.calls), [
    "owner_call.failed",
    "handoff.reopened",
  ]);
});

// ── The adapter ─────────────────────────────────────────────────────────

test("Hermes adapter: a handoff is one chat completion, Royal's rules as the system message and the call as data", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const port = hermesAssistant(
    {
      inboundSecret: null,
      problems: [],
      server: { token: "k", url: "https://hermes.example/" },
    },
    (async (url: string, init: RequestInit) => {
      requests.push({ body: JSON.parse(String(init.body)), url });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Got it, will call back." } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch,
  );
  assert.ok(port);
  const reply = await port.handOff({
    body: "Owner call: oc-1",
    callId: "call-1",
    handoffId: "h-1",
    instructions: "Handoff id: h-1.",
    reference: "task-9",
  });
  assert.equal(reply, "Got it, will call back.");
  assert.equal(requests[0].url, chatCompletionsUrl("https://hermes.example/"));
  const messages = requests[0].body.messages as {
    role: string;
    content: string;
  }[];
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Handoff id: h-1\./);
  assert.match(messages[0].content, /Your reference: task-9\./);
  assert.equal(messages[1].content, "<call>\nOwner call: oc-1\n</call>");

  const down = hermesAssistant(
    {
      inboundSecret: null,
      problems: [],
      server: { token: "k", url: "https://hermes.example/" },
    },
    (async () =>
      new Response("no", { status: 503 })) as unknown as typeof fetch,
  );
  await assert.rejects(
    down!.handOff({
      body: "",
      callId: null,
      handoffId: "h-1",
      instructions: "",
      reference: null,
    }),
    /503/,
  );
});
