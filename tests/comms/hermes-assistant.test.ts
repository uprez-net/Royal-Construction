import assert from "node:assert/strict";
import { test } from "vitest";

import { parseLookupCall } from "@/lib/comms/voice-agent/desk";
import {
  chatCompletionsUrl,
  completionText,
  HERMES_MODEL,
  hermesAssistant,
  HermesError,
} from "@/lib/hermes/assistant";
import { readHermesConfig } from "@/lib/hermes/config";

// Royal → Hermes: one chat completion to Hermes's API server per question the
// owner asks on a briefing call, and the config both directions read.

const SECRET = "s".repeat(40);

test("config: a short inbound secret is refused", () => {
  const config = readHermesConfig({ HERMES_MCP_SECRET: "short" });
  assert.equal(config.inboundSecret, null);
  assert.equal(config.problems.length, 1);
  const ok = readHermesConfig({
    HERMES_MCP_SECRET: SECRET,
    HERMES_SERVER_TOKEN: "t",
    HERMES_SERVER_URL: "https://hermes.example",
  });
  assert.equal(ok.inboundSecret, SECRET);
  assert.deepEqual(ok.server, { token: "t", url: "https://hermes.example/" });
  assert.deepEqual(ok.problems, []);
});

test("config: plain http to Hermes's IP connects, with a warning on the admin panel", () => {
  const config = readHermesConfig({
    HERMES_SERVER_TOKEN: "t",
    HERMES_SERVER_URL: "http://78.47.57.195:8642",
  });
  assert.deepEqual(config.server, {
    token: "t",
    url: "http://78.47.57.195:8642/",
  });
  assert.equal(config.problems.length, 1);
  assert.match(config.problems[0], /unencrypted/);
  // localhost is local development: no warning.
  assert.deepEqual(
    readHermesConfig({
      HERMES_SERVER_TOKEN: "t",
      HERMES_SERVER_URL: "http://localhost:8642",
    }).problems,
    [],
  );
});

test("config: only https or http, and never a credential in the URL", () => {
  const server = (url: string) =>
    readHermesConfig({
      HERMES_SERVER_TOKEN: "t",
      HERMES_SERVER_URL: url,
    }).server;
  for (const refused of [
    "ws://localhost",
    "ftp://localhost",
    "file://localhost",
    "https://user:pass@hermes.example",
    "https://user@hermes.example",
  ]) {
    assert.equal(server(refused), null, refused);
  }
  assert.ok(server("http://localhost:8642"));
  assert.ok(server("https://hermes.example"));
});

test("config: a URL without a token is reported, not half-connected", () => {
  const config = readHermesConfig({
    HERMES_SERVER_URL: "https://hermes.example",
  });
  assert.equal(config.server, null);
  assert.equal(config.problems.length, 1);
});

test("the endpoint is /v1/chat/completions under the base, keeping a path prefix", () => {
  assert.equal(
    chatCompletionsUrl("https://hermes.example/"),
    "https://hermes.example/v1/chat/completions",
  );
  assert.equal(
    chatCompletionsUrl("https://hermes.example/hermes"),
    "https://hermes.example/hermes/v1/chat/completions",
  );
  assert.equal(
    chatCompletionsUrl("http://localhost:8642/"),
    "http://localhost:8642/v1/chat/completions",
  );
});

// ── Mili → Hermes ───────────────────────────────────────────────────────

test("one question: one chat completion, with the bearer key, the briefing and the question", async () => {
  const sent: {
    url: string;
    body: Record<string, unknown>;
    headers: Headers;
  }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: new Headers(init.headers),
      url,
    });
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            message: {
              content: " The inspection is at 9:30. ",
              role: "assistant",
            },
          },
        ],
        id: "chatcmpl-1",
        object: "chat.completion",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const port = hermesAssistant(
    readHermesConfig({
      HERMES_SERVER_TOKEN: "hermes-token",
      HERMES_SERVER_URL: "https://hermes.example",
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
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://hermes.example/v1/chat/completions");
  assert.equal(sent[0].headers.get("authorization"), "Bearer hermes-token");
  assert.equal(sent[0].body.model, HERMES_MODEL);
  assert.equal(sent[0].body.stream, false);
  const messages = sent[0].body.messages as { role: string; content: string }[];
  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user"],
  );
  assert.equal(messages[1].content, "What time is the inspection?");
  assert.match(messages[0].content, /<briefing>\nSmith St brief\n<\/briefing>/);
  assert.match(messages[0].content, /Your reference: task-9\./);
  assert.match(messages[0].content, /call id: call-1\./);
  assert.match(messages[0].content, /not instructions/);
});

test("a non-2xx answer is a HermesError carrying the status", async () => {
  const fetcher = (async () =>
    new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
  const port = hermesAssistant(
    readHermesConfig({
      HERMES_SERVER_TOKEN: "wrong",
      HERMES_SERVER_URL: "https://hermes.example",
    }),
    fetcher,
  );
  assert.ok(port);
  await assert.rejects(
    port.ask({ callId: "c", context: "x", question: "q", reference: null }),
    (error: unknown) => error instanceof HermesError && error.status === 401,
  );
});

test("an answer that isn't a chat completion is a throw, not something to read out", () => {
  assert.throws(() => completionText({ error: "busy" }), HermesError);
  assert.throws(() => completionText(null), HermesError);
  assert.throws(() => completionText({ choices: [] }), HermesError);
  assert.equal(
    completionText({
      choices: [
        {
          message: {
            content: [
              { text: "Raj and the certifier.", type: "text" },
              { type: "image_url" },
            ],
          },
        },
      ],
    }),
    "Raj and the certifier.",
  );
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
