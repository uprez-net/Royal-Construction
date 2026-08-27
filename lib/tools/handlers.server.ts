import { z } from "zod";

import { getCachedCustomersForDropdown } from "@/lib/data/customers";
import { getLeads } from "@/lib/data/leads";
import { addMaterialToProject } from "@/lib/data/material";
import { getMilestonesByProject } from "@/lib/data/milestones";
import {
    getCachedProjectById,
    getCachedProjects,
    getCachedProjectsForLookup,
} from "@/lib/data/projects";
import { getCachedSiteManagersForDropdown } from "@/lib/data/siteManagers";
import { getCachedTradies, getTradiesForLookup } from "@/lib/data/tradies";
import { createVariation, updateVariationStatus } from "@/lib/data/variations";
import { parseLeadStageFilter } from "@/lib/leads/types";
import { fetchJson } from "@/utils/fetch";
import type { AddressSuggestion } from "@/utils/validators/files";
import {
    customerLookupResponseSchema,
    leadsResponseSchema,
    materialResponseSchema,
    projectDetailResponseSchema,
    projectLookupResponseSchema,
    projectsResponseSchema,
    siteManagerLookupResponseSchema,
    variationResponseSchema,
} from "@/utils/validators/mcp";
import type { LeadStage as DBLeadStage } from "@prisma/client";

import {
    addressLookupResponseSchema,
    getTradieResponseSchema,
    milestonesListResponseSchema,
    type addressLookupToolSchema,
    type variationCreateToolSchema,
    type variationUpdateToolSchema,
} from "./manifest";
import { removeAllNestedDateObjects, toToolError, toToolResult, toolErrorText, type ToolResult } from "./result";

import type { leadLookupParamSchema } from "@/utils/validators/lead";
import type { customerLookupQuerySchema, siteManagerLookupQuerySchema } from "@/utils/validators/lookups";
import type { addMaterialSchema } from "@/utils/validators/material";
import type {
    projectListQuerySchema,
    projectLookupQuerySchema,
    projectParamSchema,
} from "@/utils/validators/projects";
import type { tradieSearchQuerySchema } from "@/utils/validators/tradies";

/** Who the tool is acting as. Supplied by whichever transport dispatched it. */
export type ToolContext = {
    /** Clerk user id: from the OAuth token over MCP, from the session cookie in the browser. */
    clerkUserId?: string;
};

/**
 * Handlers are written against their own argument type; the registry erases
 * that when it builds the dispatch table. See registry.server.ts.
 */
export type ToolInvoker = (args: unknown, ctx: ToolContext) => Promise<ToolResult>;

type In<T> = T extends z.ZodType ? z.output<T> : never;

/**
 * Every handler validated its result against an output schema with the same
 * six lines: safeParse, console.error the treeified issues, throw a message the
 * catch block turns into a tool error. That is the whole of it, once.
 */
function validated<T extends z.ZodType>(schema: T, data: unknown, label: string): z.output<T> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        console.error(`Invalid ${label}`, z.treeifyError(parsed.error));
        throw new Error(`Invalid ${label}`);
    }
    return parsed.data;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

async function get_customer(params: In<typeof customerLookupQuerySchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(
            await getCachedCustomersForDropdown(params.page, params.limit, params.q || params.search),
        );
        return toToolResult(validated(customerLookupResponseSchema, res, "customer lookup response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching customers", error));
    }
}

async function get_site_managers(params: In<typeof siteManagerLookupQuerySchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(
            await getCachedSiteManagersForDropdown(params.page, params.limit, params.q || params.search),
        );
        return toToolResult(validated(siteManagerLookupResponseSchema, res, "site manager lookup response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching site managers", error));
    }
}

async function get_tradies(params: In<typeof tradieSearchQuerySchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await getTradiesForLookup(params.limit, params.q || params.search));
        return toToolResult(validated(getTradieResponseSchema, res, "tradie lookup response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching tradies", error));
    }
}

async function get_all_tradies(): Promise<ToolResult> {
    try {
        const tradies = removeAllNestedDateObjects(await getCachedTradies()) as Awaited<
            ReturnType<typeof getCachedTradies>
        >;
        const payload = { tradies, totalCount: Array.isArray(tradies) ? tradies.length : 0 };
        return toToolResult(validated(getTradieResponseSchema, payload, "tradies response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching tradies", error));
    }
}

async function address_council_lookup({ query, limit }: In<typeof addressLookupToolSchema>): Promise<ToolResult> {
    try {
        const trimmedQuery = query.trim();

        const response = await fetchJson<{
            suggestions: AddressSuggestion[];
            count: number;
        }>(
            `/api/address?query=${encodeURIComponent(trimmedQuery)}&limit=${limit ?? 5}`,
            { method: "GET" },
            "Error fetching location suggestions",
        );

        return toToolResult(validated(addressLookupResponseSchema, response.data, "address lookup response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching address suggestions", error));
    }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

async function get_projects(params: In<typeof projectListQuerySchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await getCachedProjects(params));
        return toToolResult(validated(projectsResponseSchema, res, "projects response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching projects", error));
    }
}

async function get_project_lookup(params: In<typeof projectLookupQuerySchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(
            await getCachedProjectsForLookup(params.page, params.limit, params.q),
        );
        return toToolResult(validated(projectLookupResponseSchema, res, "project lookup response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching projects for lookup", error));
    }
}

async function get_project(params: In<typeof projectParamSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await getCachedProjectById(params.projectId));
        return toToolResult(validated(projectDetailResponseSchema, res, "project detail response"));
    } catch (error) {
        return toToolError(toolErrorText("Error fetching project", error));
    }
}

// ---------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------

async function create_variation(params: In<typeof variationCreateToolSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await createVariation(params.projectId, params));
        return toToolResult(validated(variationResponseSchema, res, "variation response"));
    } catch (error) {
        return toToolError(toolErrorText("Error creating variation", error));
    }
}

async function update_variation_status(params: In<typeof variationUpdateToolSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await updateVariationStatus(params.variationId, params.status));
        return toToolResult(validated(variationResponseSchema, res, "variation response"));
    } catch (error) {
        return toToolError(toolErrorText("Error updating variation status", error));
    }
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

async function get_milestones(params: In<typeof projectParamSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(
            await getMilestonesByProject(params.projectId),
        ) as Awaited<ReturnType<typeof getMilestonesByProject>>;
        return toToolResult(
            validated(milestonesListResponseSchema, { milestones: res, totalCount: res.length }, "milestones response"),
        );
    } catch (error) {
        return toToolError(toolErrorText("Error fetching milestones", error));
    }
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

async function get_leads({ q, status, filterTiming, page, limit }: In<typeof leadLookupParamSchema>): Promise<ToolResult> {
    try {
        // See the note in app/api/(data)/leads/route.ts: an unknown
        // label silently widened the query to every lead.
        let statusFilterArray: DBLeadStage[] | undefined;
        if (status) {
            const { stages, unknown } = parseLeadStageFilter(status);
            if (unknown.length > 0) {
                throw new Error(`Unknown lead stage filter: ${unknown.join(", ")}`);
            }
            statusFilterArray = stages;
        }
        const res = removeAllNestedDateObjects(await getLeads(page, limit, q, statusFilterArray, filterTiming));
        return toToolResult(validated(leadsResponseSchema, res, "leads response"));
    } catch (error) {
        // isError so the client sees a failure. Without it an unknown
        // stage filter returns a "successful" result whose text merely
        // happens to start with "Error", which a model reads as data.
        return toToolError(toolErrorText("Error fetching leads", error));
    }
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

async function add_material(params: In<typeof addMaterialSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await addMaterialToProject(params.projectId, params.materialData));
        return toToolResult(validated(materialResponseSchema, res, "material response"));
    } catch (error) {
        return toToolError(toolErrorText("Error adding material", error));
    }
}

// ---------------------------------------------------------------------------

export const TOOL_HANDLERS = {
    get_customer,
    get_site_managers,
    get_tradies,
    get_projects,
    get_project_lookup,
    get_project,
    create_variation,
    update_variation_status,
    get_milestones,
    get_leads,
    get_all_tradies,
    add_material,
    address_council_lookup,
};

export type ToolHandlerName = keyof typeof TOOL_HANDLERS;
