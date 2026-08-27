import { auth } from "@clerk/nextjs/server";
import { RateLimiter } from "limiter";
import { z } from "zod";

import { getUserByClerkIdCached } from "@/lib/data/user";
import { assertRole, ToolAuthorizationError } from "@/lib/tools/authz";
import { getRegisteredTool } from "@/lib/tools/registry.server";
import type { AppRole } from "@/lib/tools/types";
import {
    badRequestResponse,
    errorResponse,
    forbiddenResponse,
    notFoundResponse,
    successResponse,
    unauthorizedResponse,
} from "@/utils/validators/response";

/**
 * The WebMCP bridge.
 *
 * A browser agent (ChatGPT Desktop's built-in browser, or any Chrome/Edge with
 * the origin trial) calls a tool registered by components/webmcp/webmcp-provider
 * and lands here. The difference from /api/mcp is authentication: there is no
 * OAuth dance, because the request carries the user's Clerk session cookie —
 * proxy.ts already rejects an unauthenticated /api/* request with a 401, and
 * this path is deliberately absent from its isPublicRoute list.
 *
 * That convenience is exactly why this route, not the browser, owns the
 * authorization decision. A page-registered tool runs with the full ambient
 * session; the role gate has to sit where the agent cannot reach it.
 */

const requestSchema = z.object({
    args: z.unknown().optional(),
});

/**
 * Per-user call ceiling. An agent loop can call a tool far faster than a person
 * can, and every call here is a real database write or read.
 *
 * Instance-local: it bounds a runaway loop within one lambda, which is the case
 * that actually happens. It is not a distributed quota, and is not trying to be.
 */
const CALLS_PER_MINUTE = 60;
const limiters = new Map<string, RateLimiter>();

function withinRateLimit(userId: string): boolean {
    let limiter = limiters.get(userId);
    if (!limiter) {
        limiter = new RateLimiter({ tokensPerInterval: CALLS_PER_MINUTE, interval: "minute" });
        limiters.set(userId, limiter);
    }
    return limiter.tryRemoveTokens(1);
}

export async function POST(request: Request, ctx: { params: Promise<{ tool: string }> }) {
    const { tool: toolName } = await ctx.params;

    const tool = getRegisteredTool(toolName);
    // A tool that is not browser-facing is indistinguishable from one that does
    // not exist, so the agent cannot enumerate the server-only surface.
    if (!tool || tool.surface === "server") {
        return notFoundResponse("Tool");
    }

    const { userId } = await auth();
    if (!userId) {
        return unauthorizedResponse();
    }

    if (!withinRateLimit(userId)) {
        return errorResponse("Too many tool calls. Slow down and try again shortly.", {
            status: 429,
            code: "RATE_LIMITED",
        });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return badRequestResponse("Request body must be valid JSON.");
    }

    const envelope = requestSchema.safeParse(body);
    if (!envelope.success) {
        return badRequestResponse("Expected a JSON body of the form { args }.", {
            issues: z.treeifyError(envelope.error) as Record<string, unknown>,
        });
    }

    const user = await getUserByClerkIdCached(userId);
    try {
        assertRole(tool.name, tool.requiredRole, user?.role as AppRole | undefined);
    } catch (error) {
        if (error instanceof ToolAuthorizationError) {
            return forbiddenResponse(error.message);
        }
        throw error;
    }

    const parsed = tool.inputSchema.safeParse(envelope.data.args ?? {});
    if (!parsed.success) {
        return badRequestResponse(`Invalid arguments for ${tool.name}.`, {
            issues: z.treeifyError(parsed.error) as Record<string, unknown>,
        });
    }

    try {
        const result = await tool.invoke(parsed.data, { clerkUserId: userId });

        // WebMCP has no outputSchema in the current IDL, so the browser path
        // would otherwise lose the response guarantee the MCP path has. Keep it
        // by validating here instead — a failure is logged, not fatal, because
        // the agent is better served by a slightly-off payload than by nothing.
        if (tool.outputSchema && !result.isError && result.structuredContent) {
            const checked = tool.outputSchema.safeParse(result.structuredContent);
            if (!checked.success) {
                console.error(`WebMCP ${tool.name} returned an off-schema payload`, z.treeifyError(checked.error));
            }
        }

        // Mutations revalidate their own cache tags inside lib/data/* (see
        // milestones.ts, tradieSchedules.ts, projectsWrite.ts and friends), so
        // there is nothing to re-tag here. The client still needs to know to
        // refresh the router — that is what `mutated` signals.
        return successResponse({
            ...result,
            mutated: !tool.annotations.readOnlyHint,
        });
    } catch (error) {
        console.error(`WebMCP tool ${tool.name} threw`, error);
        return errorResponse(error instanceof Error ? error.message : "Tool execution failed.", {
            code: "TOOL_ERROR",
        });
    }
}
