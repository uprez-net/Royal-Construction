"use client";

import type { z } from "zod";

/**
 * Result helpers for tools a screen registers itself.
 *
 * The bridged tools get their shape from lib/tools/result.ts on the server.
 * Screen-registered tools have no server leg, so they build the same dual
 * `structuredContent` + `content` shape here — an agent should not be able to
 * tell which transport a tool used from its result.
 */

export type WebMcpToolResult = {
    structuredContent?: Record<string, unknown>;
    content: { type: "text"; text: string }[];
    isError?: boolean;
};

/** A plain sentence back to the agent. Use for UI actions with no payload. */
export function webMcpText(text: string): WebMcpToolResult {
    return { content: [{ type: "text", text }] };
}

/** A structured payload, mirrored as text for clients that only render text. */
export function webMcpJson(data: Record<string, unknown>): WebMcpToolResult {
    return {
        structuredContent: data,
        content: [{ type: "text", text: JSON.stringify(data) }],
    };
}

/**
 * A failure the agent can act on.
 *
 * `isError` matters: without it the agent reads a sentence that merely starts
 * with "Error" as data, and carries on as though the write had succeeded.
 */
export function webMcpError(text: string): WebMcpToolResult {
    return { isError: true, content: [{ type: "text", text }] };
}

/**
 * Flattens a Zod failure into one sentence naming the offending fields.
 *
 * `error.message` is a raw JSON blob — useless to a model deciding what to send
 * next. Naming the field and the rule is what lets it retry correctly.
 */
export function summariseZodIssues(error: z.ZodError): string {
    const issues = error.issues.map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
    });
    return issues.join("; ") || "The arguments did not match the tool schema.";
}
