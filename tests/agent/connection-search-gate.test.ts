import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { describe, it, vi } from "vitest";

const discovered = { connection_search: {} };
const frameworkResolver = vi.fn(() => discovered);

vi.mock("eve/tools/connection_search", () => ({
  connectionSearch: {
    kind: "eve:dynamic",
    events: { "step.started": frameworkResolver },
  },
}));

const { default: gate, mentionsPlaud } =
  await import("@/agent/tools/connection_search");

/**
 * connection_search asks every connection for its tools, and for a caller
 * without a Plaud grant that raises Plaud's sign-in and parks the turn with no
 * reply. It used to be offered on every step, and the orchestrator called it
 * for the build sequence (run 43505272370). These pin that it is offered only
 * in a conversation about Plaud recordings, and then unchanged.
 */

const ctx = (messages: ModelMessage[]) =>
  ({
    messages,
    model: null,
    session: { id: "s", auth: {} },
    channel: {},
  }) as unknown as Parameters<
    NonNullable<(typeof gate.events)["step.started"]>
  >[1];

const user = (content: ModelMessage["content"]) =>
  ({ role: "user", content }) as ModelMessage;

describe("connection_search gate", () => {
  for (const question of [
    "Show me the admin build sequence template used for new projects.",
    "What reference code was I given in my other conversation?",
    "Which electricians are in our tradie directory?",
    "Record the deposit against the Smith lead.",
  ]) {
    it(`is not offered for: ${question}`, async () => {
      frameworkResolver.mockClear();
      const step = gate.events["step.started"];
      assert.ok(step);
      assert.equal(await step({}, ctx([user(question)])), null);
      assert.equal(frameworkResolver.mock.calls.length, 0);
    });
  }

  it("hands a Plaud conversation to the framework resolver unchanged", async () => {
    frameworkResolver.mockClear();
    const step = gate.events["step.started"];
    assert.ok(step);
    const event = { type: "step.started" };
    const context = ctx([
      user("Find yesterday's Plaud recording with the Nguyens."),
      { role: "assistant", content: "Which one?" } as ModelMessage,
      user("The second one, and the transcript please."),
    ]);
    assert.equal(await step(event, context), discovered);
    assert.deepEqual(frameworkResolver.mock.calls[0], [event, context]);
  });

  it("reads text parts only, never attachment data", () => {
    assert.equal(
      mentionsPlaud([
        user([{ type: "text", text: "Summarise the transcript I attached." }]),
      ]),
      true,
    );
    assert.equal(
      mentionsPlaud([
        user([
          { type: "text", text: "Summarise this site note." },
          {
            type: "file",
            mediaType: "text/plain",
            data: "plaud recording transcript",
          },
        ]),
      ]),
      false,
    );
  });

  it("ignores the words when only the assistant used them", () => {
    assert.equal(
      mentionsPlaud([
        user("Any news on the Smith job?"),
        {
          role: "assistant",
          content: "I can also check Plaud recordings.",
        } as ModelMessage,
      ]),
      false,
    );
  });
});
