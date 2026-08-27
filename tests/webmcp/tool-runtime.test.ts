import assert from "node:assert/strict";
import { test } from "node:test";

import {
    normaliseToolInput,
    normaliseToolOptions,
    runToolSafely,
} from "../../components/webmcp/tool-runtime";

/**
 * These guard the two ways a WebMCP implementation can differ from the spec
 * without saying so.
 *
 * The cost of getting either wrong is the same and it is unusually high: the
 * user agent swallows whatever a tool callback throws and hands the caller a
 * bare `UnknownError: Tool was executed but the invocation failed`. No message,
 * no stack, no tool name. A regression here is invisible until someone opens
 * the console.
 */

test("tool input accepts the object form the spec describes", () => {
    assert.deepEqual(normaliseToolInput({ query: "shed" }), { query: "shed" });
});

test("tool input accepts the JSON string form implementations send", () => {
    assert.deepEqual(normaliseToolInput('{"query":"shed"}'), { query: "shed" });
});

test("tool input degrades to an empty object rather than throwing", () => {
    // A tool that sees {} reports a validation failure the agent can act on.
    // A tool that throws produces an UnknownError nobody can read.
    for (const input of [undefined, null, "", "   ", "not json", "[1,2]", 42, [1, 2]]) {
        assert.deepEqual(normaliseToolInput(input), {}, `failed for ${JSON.stringify(input)}`);
    }
});

test("options are synthesised when the implementation omits them", () => {
    // Reading `options.signal` off undefined is what turned every bridged tool
    // into an UnknownError.
    const resolved = normaliseToolOptions(undefined);
    assert.ok(resolved.signal instanceof AbortSignal);
    assert.equal(resolved.signal.aborted, false);
});

test("options are passed through when the implementation supplies them", () => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    assert.equal(normaliseToolOptions(options), options);
});

test("a successful tool returns its own result", async () => {
    const result = await runToolSafely(
        "demo",
        async (input) => ({ echoed: input.query }),
        { query: "shed" },
        undefined,
    );
    assert.deepEqual(result, { echoed: "shed" });
});

test("a throwing tool resolves as an error result, never rejects", async () => {
    const result = (await runToolSafely(
        "demo",
        () => {
            throw new Error("the database said no");
        },
        {},
        undefined,
    )) as { isError?: boolean; content: { text: string }[] };

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /demo failed: the database said no/);
});

test("a tool callback never sees a missing options argument", async () => {
    let seen: unknown;
    await runToolSafely(
        "demo",
        (_input, options) => {
            seen = options.signal;
            return null;
        },
        {},
        undefined,
    );
    assert.ok(seen instanceof AbortSignal);
});

test("an abort is re-thrown rather than reported as a tool failure", async () => {
    // Cancellation is the agent's own doing. Reporting it as a failure would
    // tell the model its call was wrong when the model is what stopped it.
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
        () =>
            runToolSafely(
                "demo",
                () => {
                    throw new Error("aborted");
                },
                {},
                { signal: controller.signal },
            ),
        /aborted/,
    );
});
