import { z } from "zod";

import { leadLookupParamSchema } from "@/utils/validators/lead";
import {
    customerLookupQuerySchema,
    siteManagerLookupQuerySchema,
} from "@/utils/validators/lookups";
import { addMaterialSchema } from "@/utils/validators/material";
import {
    createVariationSchema,
    projectListQuerySchema,
    projectLookupQuerySchema,
    projectParamSchema,
    variationParamSchema,
} from "@/utils/validators/projects";
import { tradieSearchQuerySchema } from "@/utils/validators/tradies";
import {
    customerLookupResponseSchema,
    leadsResponseSchema,
    materialResponseSchema,
    milestoneResponseSchema,
    projectDetailResponseSchema,
    projectLookupResponseSchema,
    projectsResponseSchema,
    siteManagerLookupResponseSchema,
    tradiesResponseSchema,
    variationResponseSchema,
} from "@/utils/validators/mcp";

import type { ToolDescriptor } from "./types";

/**
 * The shared tool manifest.
 *
 * Scope note: this file holds the tools that are the *same* operation whether a
 * backend agent calls them over MCP or a browser agent calls them through the
 * bridge — reads, plus the two writes whose server contract and browser
 * contract still agree.
 *
 * The write tools that drive the leads and projects screens are NOT here. Their
 * browser flows diverged from the server-action signatures these tools used to
 * wrap (project creation now runs through `createProjectWithLead` off an
 * extracted tender/contract, milestone updates go through the milestone
 * `/updates` route, lead writes go through `lib/leads/leads-service`), so they
 * are registered by the screens that own them, against the exact code path the
 * UI uses. See components/leads/leads.tsx, components/projects/*-screen.tsx and
 * docs/webmcp-capability.md.
 */

// ---------------------------------------------------------------------------
// Composite schemas
// ---------------------------------------------------------------------------

export const emptyInputSchema = z.object({}).strict();

export const variationCreateToolSchema = projectParamSchema.extend(createVariationSchema.shape);
export const variationUpdateToolSchema = variationParamSchema.extend({
    status: z.enum(["APPROVED", "REJECTED"]),
});

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

export const milestonesListResponseSchema = z.object({
    milestones: z.array(milestoneResponseSchema),
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
        description: "Search tradies for dropdowns and lookup",
        inputSchema: tradieSearchQuerySchema,
        outputSchema: getTradieResponseSchema,
        annotations: { readOnlyHint: true },
        surface: "both",
    },
    {
        name: "get_projects",
        description: "List projects with stats",
        inputSchema: projectListQuerySchema,
        outputSchema: projectsResponseSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        surface: "both",
    },
    {
        name: "get_project_lookup",
        description: "Lookup projects for dropdowns",
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
        name: "create_variation",
        description: "Create a project variation",
        inputSchema: variationCreateToolSchema,
        outputSchema: variationResponseSchema,
        annotations: { readOnlyHint: false },
        surface: "both",
    },
    {
        name: "update_variation_status",
        description: "Approve or reject a variation",
        inputSchema: variationUpdateToolSchema,
        outputSchema: variationResponseSchema,
        annotations: { readOnlyHint: false },
        // Approving a variation commits the business to a cost change.
        requiredRole: "ADMIN",
        surface: "both",
    },
    {
        name: "get_milestones",
        description: "List milestones for a project",
        inputSchema: projectParamSchema,
        outputSchema: milestonesListResponseSchema,
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
        name: "get_all_tradies",
        description: "List all tradies for scheduling",
        inputSchema: emptyInputSchema,
        outputSchema: getTradieResponseSchema,
        annotations: { readOnlyHint: true },
        surface: "both",
    },
    {
        name: "add_material",
        description: "Add material to a project",
        inputSchema: addMaterialSchema,
        outputSchema: materialResponseSchema,
        annotations: { readOnlyHint: false },
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
