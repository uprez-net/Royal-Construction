import { TOOL_MANIFEST } from "./manifest";
import { TOOL_HANDLERS, type ToolContext, type ToolInvoker } from "./handlers.server";
import type { ToolDescriptor } from "./types";

export type { ToolContext, ToolInvoker };

export type RegisteredTool = ToolDescriptor & { invoke: ToolInvoker };

/**
 * The single list both server entry points iterate: the MCP server at
 * app/(mcp)/api/mcp/route.ts and the WebMCP browser bridge at
 * app/api/webmcp/[tool]/route.ts.
 *
 * Building it eagerly means a manifest entry with no handler (or the reverse)
 * fails at import time rather than on the first agent call.
 */
export const TOOL_REGISTRY: readonly RegisteredTool[] = TOOL_MANIFEST.map((tool) => {
    const handler = (TOOL_HANDLERS as Record<string, unknown>)[tool.name];
    if (typeof handler !== "function") {
        throw new Error(`Tool "${tool.name}" is in the manifest but has no handler.`);
    }
    // Each handler is written against its own parsed argument type; that is
    // erased here so the dispatch table has one uniform signature. The args are
    // parsed against the manifest schema before they ever reach this call.
    return { ...tool, invoke: handler as ToolInvoker };
});

const ORPHANED = Object.keys(TOOL_HANDLERS).filter(
    (name) => !TOOL_MANIFEST.some((tool) => tool.name === name),
);
if (ORPHANED.length > 0) {
    throw new Error(`Tool handlers with no manifest entry: ${ORPHANED.join(", ")}`);
}

const BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

export function getRegisteredTool(name: string): RegisteredTool | undefined {
    return BY_NAME.get(name);
}
