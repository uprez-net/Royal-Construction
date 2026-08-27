import { TOOL_MANIFEST } from "./manifest";
import { toToolInputJsonSchema } from "./zod-to-json-schema";
import type { ToolDescriptor } from "./types";

export { toToolInputJsonSchema };

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
