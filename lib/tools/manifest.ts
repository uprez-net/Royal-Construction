import { z } from "zod";

import { leadLookupParamSchema } from "@/utils/validators/lead";
import {
    customerLookupQuerySchema,
    siteManagerLookupQuerySchema,
} from "@/utils/validators/lookups";
import {
    projectLookupQuerySchema,
    projectParamSchema,
} from "@/utils/validators/projects";
import { tradieSearchQuerySchema } from "@/utils/validators/tradies";
import {
    customerLookupResponseSchema,
    leadsResponseSchema,
    projectDetailResponseSchema,
    projectLookupResponseSchema,
    siteManagerLookupResponseSchema,
    tradiesResponseSchema,
} from "@/utils/validators/mcp";

import type { ToolDescriptor } from "./types";

/**
 * The shared tool manifest.
 *
 * Scope note: this file holds cheap, always-relevant *lookups* — the operations
 * that mean the same thing whether a backend agent calls them over MCP or a
 * browser agent calls them through the bridge, and that are worth carrying on
 * every page because any conversation might start with one.
 *
 * Nothing that writes is here any more, and that is deliberate. The write tools
 * that drive the leads and projects screens diverged from the server-action
 * signatures they used to wrap (project creation now runs through
 * `createProjectWithLead` off an extracted tender/contract, milestone updates go
 * through the milestone `/updates` route, lead writes go through
 * `lib/leads/leads-service`), so they are registered by the screens that own
 * them, against the exact code path a click takes.
 *
 * Nor is everything readable here. A read whose payload is large, or whose
 * answer only makes sense on one screen, belongs to that screen too — see
 * docs/webmcp-capability.md for which read lives where, and why `get_projects`
 * and `get_all_tradies` left.
 */

// ---------------------------------------------------------------------------
// Composite schemas
// ---------------------------------------------------------------------------

/**
 * Was an inline ZodRawShape in the route. Promoted to a ZodObject so every
 * manifest entry converts to JSON Schema through the same code path; the MCP
 * SDK accepts either form and derives the same schema from both.
 */
export const addressLookupToolSchema = z.object({
    query: z.string().describe("The address to look up"),
    limit: z.number().optional().describe("Max number of results"),
});

// ---------------------------------------------------------------------------
// Composite response schemas
// ---------------------------------------------------------------------------

export const getTradieResponseSchema = z.object({
    tradies: tradiesResponseSchema,
    totalCount: z.number(),
});

export const addressLookupResponseSchema = z.object({
    suggestions: z.array(z.object({
        placeId: z.string(),
        address: z.string(),
        lat: z.number(),
        lng: z.number(),
        council: z.string().optional(),
        state: z.string().optional(),
    })),
    count: z.number(),
});

// ---------------------------------------------------------------------------
// The manifest
//
// One entry per tool. Transport-agnostic: no handlers, no server-only imports,
// safe to pull into the client bundle. Handlers live in ./handlers.server.ts
// and are joined to this list by ./registry.server.ts.
//
// readOnlyHint follows the verb (get_* and *_lookup read, everything else
// writes). untrustedContentHint is set where the payload carries text authored
// outside the organisation: lead notes and Graph-ingested email bodies reach
// the lead, project and milestone payloads.
// ---------------------------------------------------------------------------

export const TOOL_MANIFEST: readonly ToolDescriptor[] = [
    {
        name: "get_customer",
        description: "Get customer information for project creation",
        inputSchema: customerLookupQuerySchema,
        outputSchema: customerLookupResponseSchema,
        annotations: { readOnlyHint: true },
        surface: "both",
    },
    {
        name: "get_site_managers",
        description: "List site managers for assignment",
        inputSchema: siteManagerLookupQuerySchema,
        outputSchema: siteManagerLookupResponseSchema,
        annotations: { readOnlyHint: true },
        surface: "both",
    },
    {
        name: "get_tradies",
        description:
            "Search tradies by name or trade. Use q or search to narrow, and limit to cap the result — there is no unfiltered listing, because the full directory is too large to be useful in a tool result.",
        inputSchema: tradieSearchQuerySchema,
        outputSchema: getTradieResponseSchema,
        annotations: { readOnlyHint: true },
        surface: "both",
    },
    {
        name: "get_project_lookup",
        description:
            "List projects as id, name and location, for resolving a project the user named in words. Requires mode: \"lookup\". Takes q to search, and page/limit to page. This is the way to turn \"the Henderson job\" into a project id before navigating to it.",
        inputSchema: projectLookupQuerySchema,
        outputSchema: projectLookupResponseSchema,
        annotations: { readOnlyHint: true },
        surface: "both",
    },
    {
        name: "get_project",
        description: "Get a project by id",
        inputSchema: projectParamSchema,
        outputSchema: projectDetailResponseSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        surface: "both",
    },
    {
        name: "get_leads",
        description: "List all leads",
        inputSchema: leadLookupParamSchema,
        outputSchema: leadsResponseSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        surface: "both",
    },
    {
        name: "address_council_lookup",
        title: "Address Council Lookup",
        description: "Lookup council information based on address",
        inputSchema: addressLookupToolSchema,
        outputSchema: addressLookupResponseSchema,
        annotations: { readOnlyHint: true },
        surface: "both",
    },
];

export const TOOL_NAMES = TOOL_MANIFEST.map((tool) => tool.name);

export function findTool(name: string): ToolDescriptor | undefined {
    return TOOL_MANIFEST.find((tool) => tool.name === name);
}
