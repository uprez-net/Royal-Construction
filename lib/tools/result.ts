/**
 * Result helpers shared by every tool transport.
 *
 * Both the MCP server (app/(mcp)/api/mcp/route.ts) and the WebMCP browser
 * bridge (app/api/webmcp/[tool]/route.ts) return the same dual shape:
 * `structuredContent` for clients that want JSON, plus a `content` text mirror
 * for clients that only render text. WebMCP's `execute` may return anything,
 * so the dual shape is the safe superset rather than a second format.
 */

/**
 * Prisma hands back `Date` objects, which do not survive JSON transport in a
 * shape a model can read back. Flatten every one to an ISO string first.
 */
export const removeAllNestedDateObjects = (value: unknown): unknown => {
    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map(removeAllNestedDateObjects);
    }

    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, val]) => [
                key,
                removeAllNestedDateObjects(val),
            ])
        );
    }

    return value;
};

export type ToolResult = {
    structuredContent?: { [key: string]: unknown };
    content: { type: "text"; text: string }[];
    isError?: boolean;
};

export const toToolResult = <T>(data: T, noStructuredContent: boolean = false): ToolResult => {
    const safeData = removeAllNestedDateObjects(data);
    return {
        structuredContent: noStructuredContent ? undefined : safeData as { [key: string]: unknown },
        content: [{ type: "text" as const, text: JSON.stringify(safeData) }],
    };
};

/**
 * `isError` is load-bearing, not decorative. A tool that declares an
 * `outputSchema` and returns a failure *without* `isError` fails the MCP SDK's
 * output validation, which replaces the real message ("Add a reason before
 * moving this lead to Lost") with a protocol error the agent cannot act on.
 * Every handler failure path must go through here.
 */
export const toToolError = (message: string): ToolResult => ({
    isError: true,
    content: [{ type: "text" as const, text: message }],
});

/** Formats a caught value the way the handlers have always formatted it. */
export const toolErrorText = (prefix: string, error: unknown) =>
    `${prefix} ${error instanceof Error ? error.message : String(error)}`;
