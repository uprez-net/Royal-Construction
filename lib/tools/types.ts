import type { z } from "zod";

/**
 * Mirrors the Prisma `Role` enum without importing the Prisma client, so this
 * module stays safe to pull into a client bundle.
 */
export type AppRole = "GUEST" | "ADMIN" | "CUSTOMER" | "SITE_MANAGER";

/**
 * Which transports a tool is offered on.
 *  - "both"    registered on the MCP server *and* in the browser via WebMCP
 *  - "server"  MCP server only (see upload_file — a base64 blob in a tool
 *              argument is not a workable browser affordance)
 *  - "browser" WebMCP only (the UI tools in components/webmcp/ui-tools.ts)
 */
export type ToolSurface = "both" | "server" | "browser";

/**
 * WebMCP's own `ToolAnnotations` (from the `webmcp-types` package — see
 * types/webmcp.d.ts), with `readOnlyHint` promoted from optional to required.
 *
 * The spec defaults it to `false`, which is the safe default for a browser but
 * the wrong one for a manifest: a tool that simply forgot to declare itself
 * would silently read as a write, or worse, a copy-pasted entry would inherit a
 * neighbour's hint. Requiring it means every tool states its own nature, and
 * tests/webmcp/manifest.test.ts checks that the statement matches the verb.
 *
 * Both fields are still only hints. The browser agent may use them to decide how
 * much confirmation a call needs, but nothing in the spec *enforces* them — real
 * enforcement is the `requiredRole` check in the bridge route.
 *
 * `untrustedContentHint` marks payloads carrying text authored outside the
 * organisation: inbound email bodies, lead notes, OCR'd attachments.
 */
export type ToolAnnotations = WebMCP.ToolAnnotations & {
    readOnlyHint: boolean;
};

export type ToolDescriptor = {
    name: string;
    title?: string;
    description: string;
    /**
     * Zod input schema. Converted to JSON Schema for WebMCP by ./json-schema.
     * Not narrowed to ZodObject: createProjectSchema is a ZodPipe (it carries a
     * `.transform()`), and the MCP SDK accepts any schema here.
     */
    inputSchema: z.ZodType;
    /**
     * Zod output schema, where the tool declares one. WebMCP has no
     * `outputSchema` in the current IDL, so this is used by the MCP server and
     * by the bridge route (which validates before responding, so the browser
     * path keeps the guarantee the MCP path has).
     */
    outputSchema?: z.ZodType;
    annotations: ToolAnnotations;
    /** Minimum role required to invoke. Enforced server-side, in the bridge. */
    requiredRole?: AppRole;
    surface: ToolSurface;
};

export const isBrowserTool = (tool: ToolDescriptor) => tool.surface !== "server";
export const isServerTool = (tool: ToolDescriptor) => tool.surface !== "browser";
