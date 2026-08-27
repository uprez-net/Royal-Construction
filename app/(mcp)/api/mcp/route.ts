import { auth } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { getUserByClerkIdCached } from "@/lib/data/user";
import { assertRole } from "@/lib/tools/authz";
import { OPERATING_GUIDE } from "@/lib/tools/operating-guide";
import { TOOL_REGISTRY } from "@/lib/tools/registry.server";
import { toToolError } from "@/lib/tools/result";
import type { AppRole } from "@/lib/tools/types";

/**
 * The MCP transport. Tool definitions no longer live here — they live in
 * lib/tools/, shared with the WebMCP browser bridge at
 * app/api/webmcp/[tool]/route.ts, so the two transports cannot drift.
 *
 * What is still route-specific: OAuth (browser tools ride the Clerk session
 * cookie instead) and the `mcp_royal_construction` prompt, which has no WebMCP
 * counterpart — the browser reaches the same text through the
 * `get_operating_guide` UI tool.
 */
const handler = createMcpHandler((server) => {
    // Register a prompt for this server that can help agent interact with the tools better
    server.registerPrompt(
        "mcp_royal_construction",
        {
            title: "Royal Construction MCP Agent Guide",
            description: "Operational guide for the Royal Construction MCP agent — explains tool catalogue, ID resolution workflows, and tool dependency chains.",
        },
        () => ({
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: OPERATING_GUIDE,
                    },
                },
            ],
        }),
    );

    for (const tool of TOOL_REGISTRY) {
        if (tool.surface === "browser") continue;

        server.registerTool(
            tool.name,
            {
                ...(tool.title ? { title: tool.title } : {}),
                description: tool.description,
                inputSchema: tool.inputSchema,
                outputSchema: tool.outputSchema,
                // Only readOnlyHint crosses over; untrustedContentHint is a
                // WebMCP annotation with no MCP equivalent.
                annotations: { readOnlyHint: tool.annotations.readOnlyHint },
            },
            async (args, { authInfo }) => {
                const clerkUserId = authInfo?.extra?.userId as string | undefined;

                try {
                    if (tool.requiredRole) {
                        const user = clerkUserId ? await getUserByClerkIdCached(clerkUserId) : null;
                        assertRole(tool.name, tool.requiredRole, user?.role as AppRole | undefined);
                    }
                } catch (error) {
                    return toToolError(error instanceof Error ? error.message : String(error));
                }

                return tool.invoke(args, { clerkUserId });
            },
        );
    }
},
    {
        serverInfo: {
            name: "MCP Royal Construction",
            version: "1.0.0",
        },
    },
    {
        basePath: "/api",
        maxDuration: 120, // seconds
        redisUrl: process.env.REDIS_URL,
        verboseLogs: true,
        disableSse: false,
        onEvent: (event) => {
            console.log("MCP Event:");
            console.dir(event, { depth: Infinity, colors: true });
        }
    });


const authHandler = withMcpAuth(handler,
    async (_, token) => {
        const clerkAuth = await auth({ acceptsToken: 'oauth_token' })
        return verifyClerkToken(clerkAuth, token)
    },
    {
        required: true,
        resourceMetadataPath: "/.well-known/oauth-protected-resource",
    });
export { authHandler as GET, authHandler as POST };
