import assert from "node:assert/strict";
import { test } from "vitest";

import { parseLookupCall } from "@/lib/comms/voice-agent/desk";
import {
  hermesAssistant,
  HermesError,
  readRpcResponse,
  toolResultText,
} from "@/lib/hermes/assistant";
import { readHermesConfig } from "@/lib/hermes/config";

// Royal → Hermes: one tools/call to Hermes's own MCP server per question the
// owner asks on a briefing call, and the config both directions read.

const SECRET = "s".repeat(40);

test("config: a short inbound secret or an http Hermes server is refused", () => {
  const config = readHermesConfig({
    HERMES_MCP_SECRET: "short",
    HERMES_SERVER_MCP_TOKEN: "t",
    HERMES_SERVER_MCP_URL: "http://hermes.example/mcp",
  });
  assert.equal(config.inboundSecret, null);
  assert.equal(config.server, null);
  assert.equal(config.problems.length, 2);
  const ok = readHermesConfig({
    HERMES_MCP_SECRET: SECRET,
    HERMES_SERVER_MCP_TOKEN: "t",
    HERMES_SERVER_MCP_URL: "https://hermes.example/mcp",
  });
  assert.equal(ok.server?.askTool, "ask");
});

// ── Mili → Hermes ───────────────────────────────────────────────────────

test("one question: initialize, initialized, then tools/call with the question, the context and the reference", async () => {
  const sent: { body: Record<string, unknown>; headers: Headers }[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ body, headers: new Headers(init.headers) });
    if (body.method === "initialize") {
      return new Response(
        JSON.stringify({ id: 1, jsonrpc: "2.0", result: {} }),
        {
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "sess-1",
          },
        },
      );
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    // An SSE answer, as a streamable HTTP server may send it.
    const event = JSON.stringify({
      id: 2,
      jsonrpc: "2.0",
      result: {
        content: [{ text: "The inspection is at 9:30.", type: "text" }],
      },
    });
    return new Response(`: keep-alive\n\nevent: message\ndata: ${event}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;

  const port = hermesAssistant(
    readHermesConfig({
      HERMES_SERVER_MCP_TOKEN: "hermes-token",
      HERMES_SERVER_MCP_TOOL: "ask_hermes",
      HERMES_SERVER_MCP_URL: "https://hermes.example/mcp",
    }),
    fetcher,
  );
  assert.ok(port);
  const answer = await port.ask({
    callId: "call-1",
    context: "Smith St brief",
    question: "What time is the inspection?",
    reference: "task-9",
  });
  assert.equal(answer, "The inspection is at 9:30.");
  assert.deepEqual(
    sent.map((request) => request.body.method),
    ["initialize", "notifications/initialized", "tools/call"],
  );
  assert.equal(sent[0].headers.get("authorization"), "Bearer hermes-token");
  assert.equal(sent[2].headers.get("mcp-session-id"), "sess-1");
  const params = sent[2].body.params as {
    name: string;
    arguments: Record<string, string>;
  };
  assert.equal(params.name, "ask_hermes");
  assert.deepEqual(params.arguments, {
    call_id: "call-1",
    context: "Smith St brief",
    question: "What time is the inspection?",
    reference: "task-9",
  });
});

test("Hermes's tool answering with an error result is a throw, not an answer to read out", async () => {
  const response = new Response(
    JSON.stringify({
      id: 2,
      jsonrpc: "2.0",
      result: {
        content: [{ text: "calendar offline", type: "text" }],
        isError: true,
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  const parsed = await readRpcResponse(response, 2);
  assert.throws(() => toolResultText(parsed.result), HermesError);
});

test("no Hermes server configured: no port, so Mili is never offered ask_hermes", () => {
  assert.equal(hermesAssistant(readHermesConfig({})), null);
});

test("the call desk's ask_hermes call is parsed into a bounded question", () => {
  assert.deepEqual(
    parseLookupCall("ask_hermes", { question: " Who's coming? " }),
    {
      name: "ask_hermes",
      question: "Who's coming?",
    },
  );
  assert.equal(parseLookupCall("ask_hermes", { question: "" }), null);
  assert.equal(
    parseLookupCall("ask_hermes", { question: "x".repeat(401) }),
    null,
  );
});
