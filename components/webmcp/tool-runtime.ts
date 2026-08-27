"use client";

import { webMcpError, type WebMcpToolResult } from "./tool-result";

/**
 * The plumbing between the browser's tool invocation and our tool callbacks.
 *
 * WebMCP is an origin-trial API whose implementations do not all match the spec
 * yet, and the failure mode when they diverge is brutal: whatever a callback
 * throws is swallowed by the user agent and re-surfaced to the caller as a bare
 * `UnknownError: Tool was executed but the invocation failed`. No message, no
 * stack, no tool name. Every tool therefore goes through `runToolSafely`, which
 * makes two guarantees:
 *
 *   1. a callback never rejects, so a failure arrives as a readable `isError`
 *      result the agent can act on rather than an opaque DOMException, and
 *   2. the arguments and options are normalised first, so a small difference in
 *      how an implementation invokes the callback cannot break a tool.
 */

/** A signal for implementations that invoke the callback without options. */
function neverAbortedSignal(): AbortSignal {
    return new AbortController().signal;
}

/**
 * Coerces whatever the user agent passed into the arguments object our tools
 * expect.
 *
 * The spec says the callback receives the deserialized object, and passes the
 * JSON string only to its own internals. Not every implementation does that,
 * and a tool that silently sees `undefined` for every field is worse than one
 * that fails loudly, so a JSON string is accepted and parsed here.
 */
export function normaliseToolInput(input: unknown): Record<string, unknown> {
    if (typeof input === "string") {
        const trimmed = input.trim();
        if (!trimmed) return {};
        try {
            const parsed: unknown = JSON.parse(trimmed);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : {};
        } catch {
            return {};
        }
    }

    if (input && typeof input === "object" && !Array.isArray(input)) {
        return input as Record<string, unknown>;
    }

    return {};
}

/** Normalises the options bag, tolerating an implementation that omits it. */
export function normaliseToolOptions(
    options: WebMCP.ToolExecuteCallbackOptions | undefined,
): WebMCP.ToolExecuteCallbackOptions {
    return options?.signal ? options : { signal: neverAbortedSignal() };
}

/**
 * Matches the spec's `ToolExecuteCallback`, which may return a value or a
 * promise of one. `runToolSafely` awaits either.
 */
export type ToolExecute = (
    input: Record<string, unknown>,
    options: WebMCP.ToolExecuteCallbackOptions,
) => unknown;

/**
 * Invokes a tool callback so that it always resolves.
 *
 * An abort is re-thrown: cancellation is the user agent's to handle, and
 * reporting it as a tool failure would tell the agent its call went wrong when
 * in fact the agent itself cancelled it.
 */
export async function runToolSafely(
    name: string,
    execute: ToolExecute,
    input: unknown,
    options: WebMCP.ToolExecuteCallbackOptions | undefined,
): Promise<unknown> {
    const resolvedOptions = normaliseToolOptions(options);

    try {
        return await execute(normaliseToolInput(input), resolvedOptions);
    } catch (error) {
        if (resolvedOptions.signal.aborted) throw error;

        // The console line is the only place the stack survives; the agent gets
        // the message.
        console.error(`WebMCP: ${name} failed`, error);
        return webMcpError(
            `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
        ) satisfies WebMcpToolResult;
    }
}
