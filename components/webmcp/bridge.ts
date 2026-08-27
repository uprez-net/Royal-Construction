"use client";

/**
 * Client half of the WebMCP bridge.
 *
 * A browser tool cannot touch Prisma, so every bridged tool posts its arguments
 * to /api/webmcp/[tool], which dispatches to the same handler the MCP server
 * uses. Authentication is the Clerk session cookie the request already carries.
 */

type BridgePayload = {
    content?: { type: "text"; text: string }[];
    structuredContent?: unknown;
    isError?: boolean;
    mutated?: boolean;
};

/** What a tool hands back to the agent: the MCP result shape, minus our own flags. */
export type BridgeToolResult = {
    content: { type: "text"; text: string }[];
    structuredContent?: unknown;
    isError?: boolean;
};

const asError = (text: string): BridgeToolResult => ({
    isError: true,
    content: [{ type: "text", text }],
});

export async function callBridgeTool(
    name: string,
    input: Record<string, unknown>,
    options: {
        signal?: AbortSignal;
        /** Called after a tool that writes, so the page the user is watching catches up. */
        onMutated?: () => void;
    } = {},
): Promise<BridgeToolResult> {
    let response: Response;
    try {
        response = await fetch(`/api/webmcp/${encodeURIComponent(name)}`, {
            method: "POST",
            signal: options.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ args: input ?? {} }),
        });
    } catch (error) {
        // An aborted call is the agent cancelling; let it propagate as an abort
        // rather than reporting it to the model as a tool failure.
        if (options.signal?.aborted) throw error;
        return asError(`Could not reach ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }

    let body: { success?: boolean; data?: BridgePayload; error?: string } | null = null;
    try {
        body = await response.json();
    } catch {
        return asError(`${name} returned a response that was not JSON (HTTP ${response.status}).`);
    }

    if (!response.ok || !body?.success) {
        // The route already puts a usable sentence in `error` — a role refusal,
        // a validation summary, the rate-limit message. Pass it through rather
        // than flattening everything to "tool failed".
        return asError(body?.error ?? `${name} failed with HTTP ${response.status}.`);
    }

    const { mutated, ...result } = body.data ?? {};
    if (mutated) {
        options.onMutated?.();
    }

    return {
        content: result.content ?? [],
        structuredContent: result.structuredContent,
        ...(result.isError ? { isError: true } : {}),
    };
}
