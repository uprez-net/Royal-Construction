import { z } from "zod";

import { TOOL_MANIFEST } from "./manifest";
import type { ToolDescriptor } from "./types";

/**
 * WebMCP tools declare their parameters as JSON Schema, not Zod. The MCP SDK
 * does this conversion for us on the server; in the browser we do it ourselves.
 *
 * Two options matter:
 *  - `io: "input"` — several input schemas use `.default()` and `z.preprocess`
 *    (see nullableTrimmedString in utils/validators/lead.ts). We want the shape
 *    the *caller* supplies, not the shape parsing produces.
 *  - `unrepresentable: "any"` — some Zod constructs have no JSON Schema
 *    equivalent. Degrading those to `{}` is strictly better than throwing at
 *    registration time and silently costing us the whole tool list.
 *
 * The `.loose()` and `z.lazy()` schemas that would be genuinely awkward here
 * (utils/validators/mcp.ts) are all *response* schemas. WebMCP has no
 * outputSchema in the current IDL, so only inputs come through this function.
 */
export function toToolInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
    return z.toJSONSchema(schema, {
        io: "input",
        unrepresentable: "any",
    }) as Record<string, unknown>;
}

export type WebMcpToolDescriptor = {
    name: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: ToolDescriptor["annotations"];
    requiredRole?: ToolDescriptor["requiredRole"];
};

/**
 * Converted once at module init, not per registration — the provider mounts on
 * every navigation and this work does not need repeating.
 */
const CONVERTED: readonly WebMcpToolDescriptor[] = TOOL_MANIFEST
    .filter((tool) => tool.surface !== "server")
    .map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: toToolInputJsonSchema(tool.inputSchema),
        annotations: tool.annotations,
        requiredRole: tool.requiredRole,
    }));

/** The bridged tools the browser should register, already in WebMCP shape. */
export function getWebMcpToolDescriptors(): readonly WebMcpToolDescriptor[] {
    return CONVERTED;
}
