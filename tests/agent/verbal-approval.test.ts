import assert from "node:assert/strict";
import { test } from "vitest";

import {
  classifyVerbalDecision,
  describeApprovalPrompt,
  interpretVerbalResponses,
  type PendingInputRequest,
} from "@/agent/lib/verbal-approval";
import {
  readJsonRpc,
  verbalApprovalHandler,
  type VerbalApprovalDeps,
} from "@/agent/lib/mcp-verbal-approvals";

// A spoken answer to an MCP approval used to reach eve as `text` with no
// option id, which eve reads as an invalid answer and denies — so "yes, go
// ahead" cancelled the action. These pin the reading of words and the
// refusal to guess.

test("a clear yes approves", () => {
  for (const text of [
    "yes",
    "Yes, go ahead",
    "yep do it",
    "ok send it",
    "approved",
    "sounds good 👍",
    "no problem, go for it",
    "Yeah that's fine",
    "sure",
  ]) {
    assert.equal(classifyVerbalDecision(text), "approve", text);
  }
});

test("a clear no rejects", () => {
  for (const text of [
    "no",
    "Nope",
    "no, hold off",
    "cancel that",
    "don't",
    "not yet",
    "reject",
    "stop",
    "nah leave it",
  ]) {
    assert.equal(classifyVerbalDecision(text), "reject", text);
  }
});

test("anything less than clear is not guessed", () => {
  for (const text of [
    "",
    "hmm",
    "what does this change?",
    "yes but don't send it yet",
    "ok wait",
    "maybe tomorrow",
    // "sure" and "okay" are approvals; negated or doubted they must not be.
    "not sure",
    "I'm not sure about that",
    "not okay",
    "that's not right",
    "yes?",
    "I think so",
  ]) {
    assert.equal(classifyVerbalDecision(text), "unclear", text);
  }
});

test("a doubtful answer never becomes an approval option", () => {
  for (const text of ["not sure", "not okay", "maybe"]) {
    const { responses, unclear } = interpretVerbalResponses(
      [{ requestId: "appr", text }],
      pending,
    );
    assert.equal(responses[0]?.optionId, undefined, text);
    assert.equal(unclear.length, 1, text);
  }
});

const pending: Record<string, PendingInputRequest> = {
  appr: {
    kind: "tool-approval",
    options: [
      { id: "approve", label: "Approve" },
      { id: "cancel", label: "Cancel" },
    ],
    requestId: "appr",
  },
  limit: {
    kind: "session-limit",
    options: [
      { id: "continue", label: "Approve" },
      { id: "stop", label: "Stop" },
    ],
    requestId: "limit",
  },
  question: { kind: "question", requestId: "question" },
};

test("words become the option id each request kind uses", () => {
  const { responses, unclear } = interpretVerbalResponses(
    [
      { requestId: "appr", text: "yes go ahead" },
      { requestId: "limit", text: "no" },
      { requestId: "question", text: "the Rose St one" },
    ],
    pending,
  );
  assert.deepEqual(unclear, []);
  assert.deepEqual(responses, [
    { optionId: "approve", requestId: "appr", text: "yes go ahead" },
    { optionId: "stop", requestId: "limit", text: "no" },
    { requestId: "question", text: "the Rose St one" },
  ]);
});

test("an answer that already names an option is left alone", () => {
  const { responses } = interpretVerbalResponses(
    [{ optionId: "cancel", requestId: "appr", text: "yes" }],
    pending,
  );
  assert.deepEqual(responses, [
    { optionId: "cancel", requestId: "appr", text: "yes" },
  ]);
});

test("an unclear approval is reported, not decided", () => {
  const { unclear } = interpretVerbalResponses(
    [{ requestId: "appr", text: "hmm what is this" }],
    pending,
  );
  assert.deepEqual(unclear, [{ requestId: "appr", text: "hmm what is this" }]);
});

test("the approval prompt names records, not ids", () => {
  const prompt = describeApprovalPrompt(
    "update_lead",
    { changes: { stage: "NEGOTIATING" }, leadId: 42 },
    { leadId: "Smith (lead #42)" },
  );
  assert.match(prompt, /Approve "Update lead" for Smith \(lead #42\)\?/);
  assert.match(prompt, /changes\.stage: NEGOTIATING/);
  assert.doesNotMatch(prompt, /leadId/);
});

// --- the HTTP bridge -------------------------------------------------------

type Call = { name: string; arguments: Record<string, unknown> };

function mcpCall(name: string, args: Record<string, unknown>, id = 7) {
  return new Request("https://example.test/eve/v1/mcp", {
    body: JSON.stringify({
      id,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: args, name },
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

const inputRequired = {
  createdAt: "2026-11-12T00:00:00.000Z",
  inputRequests: {
    appr: {
      action: {
        callId: "c1",
        input: { changes: { stage: "WON" }, leadId: 42 },
        kind: "tool-call",
        toolName: "update_lead",
      },
      allowFreeform: false,
      display: "confirmation",
      kind: "tool-approval",
      options: [
        { id: "approve", label: "Approve" },
        { id: "cancel", label: "Cancel" },
      ],
      prompt: "Approve tool call: update_lead",
      requestId: "appr",
    },
  },
  invocationId: "inv_1",
  status: "input_required",
};

function result(id: unknown, structured: unknown, sse = false) {
  const message = {
    id,
    jsonrpc: "2.0",
    result: {
      content: [{ text: JSON.stringify(structured), type: "text" }],
      structuredContent: structured,
    },
  };
  return sse
    ? new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    : Response.json(message);
}

function fakeEve(sse = false, getResult: unknown = inputRequired) {
  const calls: Call[] = [];
  const inner = async (request: Request) => {
    const body = (await request.json()) as {
      id: unknown;
      params: { name: string; arguments: Record<string, unknown> };
    };
    calls.push({ arguments: body.params.arguments, name: body.params.name });
    if (body.params.name === "agent_get")
      return result(body.id, getResult, sse);
    return result(body.id, { invocationId: "inv_1", status: "working" }, sse);
  };
  return { calls, inner };
}

const deps: VerbalApprovalDeps = {
  describeTargets: async (_request, input): Promise<Record<string, string>> =>
    input.leadId === 42 ? { leadId: "Smith (lead #42)" } : {},
};

test("a spoken yes reaches eve as optionId approve", async () => {
  const eve = fakeEve();
  const handler = verbalApprovalHandler(eve.inner, deps);
  await handler(
    mcpCall("agent_update", {
      invocationId: "inv_1",
      responses: [{ requestId: "appr", text: "yes, go ahead" }],
    }),
    {},
  );
  assert.deepEqual(
    eve.calls.map((call) => call.name),
    ["agent_get", "agent_update"],
  );
  assert.deepEqual(eve.calls[1]?.arguments.responses, [
    { optionId: "approve", requestId: "appr", text: "yes, go ahead" },
  ]);
});

test("an unclear answer never reaches eve, and says why", async () => {
  const eve = fakeEve();
  const handler = verbalApprovalHandler(eve.inner, deps);
  const response = await handler(
    mcpCall("agent_update", {
      invocationId: "inv_1",
      responses: [{ requestId: "appr", text: "what's this for?" }],
    }),
    {},
  );
  assert.deepEqual(
    eve.calls.map((call) => call.name),
    ["agent_get"],
  );
  const body = (await response.json()) as {
    result: {
      isError: boolean;
      structuredContent: { error: { code: string } };
    };
  };
  assert.equal(body.result.isError, true);
  assert.equal(body.result.structuredContent.error.code, "invalid_input");
});

test("an option-id answer is forwarded without a lookup", async () => {
  const eve = fakeEve();
  const handler = verbalApprovalHandler(eve.inner, deps);
  await handler(
    mcpCall("agent_update", {
      invocationId: "inv_1",
      responses: [{ optionId: "approve", requestId: "appr" }],
    }),
    {},
  );
  assert.deepEqual(
    eve.calls.map((call) => call.name),
    ["agent_update"],
  );
});

for (const sse of [false, true]) {
  test(`input_required prompts name the record (${sse ? "SSE" : "JSON"})`, async () => {
    const eve = fakeEve(sse);
    const handler = verbalApprovalHandler(eve.inner, deps);
    const response = await handler(
      mcpCall("agent_get", { invocationId: "inv_1" }),
      {},
    );
    const parsed = await readJsonRpc(response);
    const structured = parsed?.message.result?.structuredContent as {
      inputRequests: Record<string, { prompt: string }>;
    };
    const prompt = structured.inputRequests.appr?.prompt ?? "";
    assert.match(prompt, /Smith \(lead #42\)/);
    assert.match(prompt, /stage: WON/);
    const text = parsed?.message.result?.content?.[0]?.text ?? "";
    assert.match(
      text,
      /Smith \(lead #42\)/,
      "text content mirrors structuredContent",
    );
  });
}

test("a lookup that cannot read the pending input refuses instead of forwarding", async () => {
  for (const getResult of [
    { invocationId: "inv_1", status: "working" },
    { error: { code: "not_found" } },
  ]) {
    const eve = fakeEve(false, getResult);
    const handler = verbalApprovalHandler(eve.inner, deps);
    const response = await handler(
      mcpCall("agent_update", {
        invocationId: "inv_1",
        responses: [{ requestId: "appr", text: "yes" }],
      }),
      {},
    );
    assert.deepEqual(
      eve.calls.map((call) => call.name),
      ["agent_get"],
      "the spoken answer is not passed to eve",
    );
    const body = (await response.json()) as {
      result: {
        isError: boolean;
        structuredContent: { error: { code: string } };
      };
    };
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent.error.code, "conflict");
  }
});

for (const [name, describeTargets] of [
  ["names nothing", async () => ({})],
  [
    "fails",
    async () => {
      throw new Error("db down");
    },
  ],
] as const) {
  test(`an approval whose record lookup ${name} says it cannot be named`, async () => {
    const eve = fakeEve();
    const handler = verbalApprovalHandler(eve.inner, { describeTargets });
    const response = await handler(
      mcpCall("agent_get", { invocationId: "inv_1" }),
      {},
    );
    const parsed = await readJsonRpc(response);
    const structured = parsed?.message.result?.structuredContent as {
      inputRequests: Record<string, { prompt: string }>;
      status: string;
    };
    assert.equal(
      structured.status,
      "input_required",
      "the approval stays pending",
    );
    const prompt = structured.inputRequests.appr?.prompt ?? "";
    assert.match(
      prompt,
      /could not be named \(leadId\), so do not approve yet/,
    );
    assert.doesNotMatch(prompt, /a plain "yes, go ahead"/);
  });
}
