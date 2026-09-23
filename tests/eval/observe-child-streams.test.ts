import assert from "node:assert/strict";
import { test } from "vitest";
import type { EveEvalContext } from "eve/evals";

import { observe } from "../../evals/helpers/tool-calls";

/**
 * `observe` reads each specialist's own session stream. A read that quietly
 * returns nothing would make every "this write never ran" gate pass on a run
 * that wrote, so an unreadable or short stream has to fail the case instead.
 */

const parent = {
  events: [
    {
      data: {
        childSessionId: "wrun_child",
        name: "lead-operations",
      },
      type: "subagent.called",
    },
  ],
};

const childEvents = [
  {
    data: {
      actions: [
        {
          callId: "call_0",
          input: { note: "x" },
          kind: "tool-call",
          toolName: "create_lead_task",
        },
      ],
    },
    type: "actions.requested",
  },
  {
    data: {
      result: {
        callId: "call_0",
        kind: "tool-result",
        output: {},
        toolName: "create_lead_task",
      },
      status: "completed",
    },
    type: "action.result",
  },
];

function contextServing(body: string, tail: string | null): EveEvalContext {
  const headers = new Headers({ "content-type": "application/x-ndjson" });
  if (tail !== null) headers.set("x-eve-stream-tail-index", tail);
  return {
    signal: new AbortController().signal,
    target: {
      fetch: async () => new Response(body, { headers, status: 200 }),
    },
  } as unknown as EveEvalContext;
}

const ndjson = (events: readonly unknown[]) =>
  events.map((event) => JSON.stringify(event)).join("\n") + "\n";

test("a specialist's tool calls are read from its own session", async () => {
  const run = await observe(
    contextServing(ndjson(childEvents), String(childEvents.length - 1)),
    parent,
  );

  const write = run.calls.find((call) => call.name === "create_lead_task");
  assert.equal(write?.status, "completed");
  assert.equal(write?.subagent, "lead-operations");
});

test("a final event without a trailing newline is still read", async () => {
  const body = ndjson(childEvents).trimEnd();
  const run = await observe(
    contextServing(body, String(childEvents.length - 1)),
    parent,
  );

  assert.equal(
    run.calls.find((call) => call.name === "create_lead_task")?.status,
    "completed",
  );
});

test("a stream with no tail index fails instead of reading as empty", async () => {
  await assert.rejects(
    observe(contextServing(ndjson(childEvents), null), parent),
    /did not report a valid stream tail index/,
  );
});

test("a malformed tail index fails", async () => {
  await assert.rejects(
    observe(contextServing(ndjson(childEvents), "1.5"), parent),
    /did not report a valid stream tail index/,
  );
});

test("a stream that ends before its reported tail fails", async () => {
  await assert.rejects(
    observe(contextServing(ndjson(childEvents.slice(0, 1)), "1"), parent),
    /stream ended after 1 events; expected 2/,
  );
});
