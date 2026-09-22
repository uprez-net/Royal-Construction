import assert from "node:assert/strict";
import { test } from "node:test";

import { getAgentSessionEvents } from "../../lib/domain/agent/sessions";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

let eventId = 0;

function stamped(type: string, data: unknown = { turnId: "turn_1" }) {
  eventId += 1;
  return {
    payload: {
      data,
      meta: { at: "2026-09-22T01:00:00.000Z", id: `evt_${eventId}` },
      type,
    },
  };
}

function db(rows: readonly { payload: unknown }[]) {
  return recordingDb({
    "agentSession.findFirst": { id: "session_1" },
    "agentSessionEvent.findMany": rows,
  });
}

test("a session the principal does not own hydrates nothing", async () => {
  const recorder = recordingDb({
    "agentSession.findFirst": null,
    "agentSessionEvent.findMany": [stamped("turn.started")],
  });

  const events = await getAgentSessionEvents(
    adminPrincipal("owner_1"),
    "eve_1",
    recorder.db,
  );

  assert.deepEqual(events, []);
});

test("well-formed persisted events hydrate in order", async () => {
  const rows = [
    stamped("turn.started"),
    stamped("message.received", { message: "hi", turnId: "turn_1" }),
    stamped("turn.completed"),
  ];

  const events = await getAgentSessionEvents(
    adminPrincipal("owner_1"),
    "eve_1",
    db(rows).db,
  );

  assert.deepEqual(
    events.map((event) => (event as { type: string }).type),
    ["turn.started", "message.received", "turn.completed"],
  );
});

test("session.completed hydrates even though it carries no payload", async () => {
  const events = await getAgentSessionEvents(
    adminPrincipal("owner_1"),
    "eve_1",
    db([
      {
        payload: {
          meta: { at: "2026-09-22T01:00:00.000Z", id: "evt_x" },
          type: "session.completed",
        },
      },
    ]).db,
  );

  assert.equal(events.length, 1);
});

test("hydration stops at a row the reducer could not read", async () => {
  // `turn.started` with no `data` is the shape that would throw on
  // `event.data.turnId` during hydration and blank the workspace.
  const rows = [
    stamped("turn.started"),
    {
      payload: {
        meta: { at: "2026-09-22T01:00:00.000Z", id: "evt_bad" },
        type: "turn.started",
      },
    },
    stamped("turn.completed"),
  ];

  const events = await getAgentSessionEvents(
    adminPrincipal("owner_1"),
    "eve_1",
    db(rows).db,
  );

  // Truncated, not filtered: Eve needs a contiguous prefix, so the events after
  // the bad row are left to the live catch-up rather than replayed with a gap.
  assert.deepEqual(
    events.map((event) => (event as { type: string }).type),
    ["turn.started"],
  );
});

test("a row without a durable event id is not hydrated", async () => {
  // Eve deduplicates replayed events on `meta.id`; without one the event would
  // render twice once catch-up reaches it.
  const events = await getAgentSessionEvents(
    adminPrincipal("owner_1"),
    "eve_1",
    db([{ payload: { data: { turnId: "turn_1" }, type: "turn.started" } }]).db,
  );

  assert.deepEqual(events, []);
});

test("a stream longer than the hydration cap is left to catch-up", async () => {
  const rows = Array.from({ length: 1_501 }, () => stamped("turn.started"));

  const events = await getAgentSessionEvents(
    adminPrincipal("owner_1"),
    "eve_1",
    db(rows).db,
  );

  assert.deepEqual(events, []);
});
