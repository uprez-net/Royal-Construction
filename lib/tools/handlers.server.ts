import { put } from "@vercel/blob";
import type { LeadStage as DBLeadStage } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { z } from "zod";

import { getCachedCustomersForDropdown } from "@/lib/data/customers";
import { saveFile } from "@/lib/data/file";
import { createLead, deleteLead, getLeads, updateLead } from "@/lib/data/leads";
import { addMaterialToProject } from "@/lib/data/material";
import {
    addPhotosToMilestone,
    createMilestone,
    getMilestonesByProject,
    updateMilestone,
} from "@/lib/data/milestones";
import { createProjectUpdate } from "@/lib/data/projectUpdates";
import {
    getCachedProjectById,
    getCachedProjects,
    getCachedProjectsForLookup,
} from "@/lib/data/projects";
import { createProject } from "@/lib/data/projectsWrite";
import { getCachedSiteManagersForDropdown } from "@/lib/data/siteManagers";
import { createTradieSchedule, updateTradieSchedule } from "@/lib/data/tradieSchedules";
import {
    getCachedTradieCoordinationDashboard,
    getCachedTradies,
    getTradiesForLookup,
} from "@/lib/data/tradies";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { createVariation, updateVariationStatus } from "@/lib/data/variations";
import { parseLeadStageFilter } from "@/lib/leads/types";
import { fetchJson } from "@/utils/fetch";
import { buildBlobPath } from "@/utils/formatters";
import type { AddressSuggestion } from "@/utils/validators/files";
import {
    customerLookupResponseSchema,
    deleteLeadResponseSchema,
    leadResponseSchema,
    leadsResponseSchema,
    materialResponseSchema,
    milestoneAddPhotosResponseSchema,
    milestoneDetailResponseSchema,
    milestoneUpdateResponseSchema,
    projectDetailResponseSchema,
    projectLookupResponseSchema,
    projectsResponseSchema,
    siteManagerLookupResponseSchema,
    tradieCoordinationResponseSchema,
    tradieScheduleWriteResponseSchema,
    updateTradieScheduleResponseSchema,
    variationResponseSchema,
} from "@/utils/validators/mcp";

import {
    addressLookupResponseSchema,
    getTradieResponseSchema,
    milestonesListResponseSchema,
    uploadFileResponseSchema,
    type addPhotosToolSchema,
    type addressLookupToolSchema,
    type leadDeleteToolSchema,
    type leadUpdateToolSchema,
    type milestoneCreateToolSchema,
    type milestoneUpdateToolSchema,
    type projectCreateToolSchema,
    type projectUpdateToolSchema,
    type tradieScheduleUpdateToolSchema,
    type uploadFileToolSchema,
    type variationCreateToolSchema,
    type variationUpdateToolSchema,
} from "./manifest";
import { removeAllNestedDateObjects, toToolError, toToolResult, toolErrorText, type ToolResult } from "./result";

import type { createLeadSchema, leadLookupParamSchema } from "@/utils/validators/lead";
import type { customerLookupQuerySchema, siteManagerLookupQuerySchema } from "@/utils/validators/lookups";
import type { addMaterialSchema } from "@/utils/validators/material";
import type {
    projectListQuerySchema,
    projectLookupQuerySchema,
    projectParamSchema,
} from "@/utils/validators/projects";
import type {
    createTradieScheduleSchema,
    tradieCoordinationListQuerySchema,
    tradieSearchQuerySchema,
} from "@/utils/validators/tradies";

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

async function create_project(params: In<typeof projectCreateToolSchema>): Promise<ToolResult> {
    try {
        const projectId = await createProject(params);
        const res = removeAllNestedDateObjects(await getCachedProjectById(projectId));
        return toToolResult(validated(projectDetailResponseSchema, res, "project detail response"));
    } catch (error) {
        return toToolError(toolErrorText("Error creating project", error));
    }
}

async function create_project_update(
    params: In<typeof projectUpdateToolSchema>,
    ctx: ToolContext,
): Promise<ToolResult> {
    try {
        if (!ctx.clerkUserId) {
            throw new Error("Authenticated user is required");
        }

        const user = await getUserByClerkIdCached(ctx.clerkUserId);
        if (!user) {
            throw new Error("User not found");
        }
        await createProjectUpdate({ ...params, authorId: user.id });
        const res = removeAllNestedDateObjects(await getCachedProjectById(params.projectId));
        return toToolResult(validated(projectDetailResponseSchema, res, "project detail response"));
    } catch (error) {
        return toToolError(toolErrorText("Error creating project update", error));
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

async function create_milestone(params: In<typeof milestoneCreateToolSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await createMilestone(params.projectId, params));
        return toToolResult(validated(milestoneDetailResponseSchema, res, "milestone detail response"));
    } catch (error) {
        return toToolError(toolErrorText("Error creating milestone", error));
    }
}

async function add_milestone_photos(params: In<typeof addPhotosToolSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(
            await addPhotosToMilestone(params.projectId, params.milestoneId, params.fileIds),
        );
        return toToolResult(validated(milestoneAddPhotosResponseSchema, res, "milestone photos response"));
    } catch (error) {
        return toToolError(toolErrorText("Error adding milestone photos", error));
    }
}

async function update_milestone(params: In<typeof milestoneUpdateToolSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await updateMilestone(params.milestoneId, params));
        return toToolResult(validated(milestoneUpdateResponseSchema, res, "milestone detail response"));
    } catch (error) {
        return toToolError(toolErrorText("Error updating milestone", error));
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

async function create_lead(params: In<typeof createLeadSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await createLead(params));
        if (res && typeof res === "object" && "message" in res) {
            return toToolError(String(res.message));
        }
        return toToolResult(validated(leadResponseSchema, res, "lead response"));
    } catch (error) {
        // See the note on update_lead: outputSchema is declared, so a
        // result without isError fails SDK output validation.
        return toToolError(toolErrorText("Error creating lead", error));
    }
}

async function update_lead(params: In<typeof leadUpdateToolSchema>): Promise<ToolResult> {
    try {
        const { leadId, ...updates } = params;
        const res = removeAllNestedDateObjects(await updateLead(Number(leadId), updates));
        return toToolResult(validated(leadResponseSchema, res, "lead response"));
    } catch (error) {
        // isError, or the SDK rejects the shape: this tool declares an
        // outputSchema, and a result with neither isError nor
        // structuredContent fails output validation — replacing the
        // real message ("Add a reason before moving this lead to Lost")
        // with a generic protocol error the agent cannot act on.
        return toToolError(toolErrorText("Error updating lead", error));
    }
}

async function delete_lead(params: In<typeof leadDeleteToolSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await deleteLead(Number(params.leadId)));
        return toToolResult(validated(deleteLeadResponseSchema, res, "delete lead response"));
    } catch (error) {
        return toToolError(toolErrorText("Error deleting lead", error));
    }
}

// ---------------------------------------------------------------------------
// Tradies & schedules
// ---------------------------------------------------------------------------

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

async function get_tradie_coordination_dashboard(
    params: In<typeof tradieCoordinationListQuerySchema>,
): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await getCachedTradieCoordinationDashboard(params));
        return toToolResult(
            validated(tradieCoordinationResponseSchema, res, "tradie coordination dashboard response"),
        );
    } catch (error) {
        return toToolError(toolErrorText("Error fetching tradie coordination data", error));
    }
}

async function create_tradie_schedule(params: In<typeof createTradieScheduleSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await createTradieSchedule(params));
        return toToolResult(validated(tradieScheduleWriteResponseSchema, res, "tradie schedule response"));
    } catch (error) {
        return toToolError(toolErrorText("Error creating tradie schedule", error));
    }
}

async function update_tradie_schedule(params: In<typeof tradieScheduleUpdateToolSchema>): Promise<ToolResult> {
    try {
        const { scheduleId, ...updates } = params;
        const res = removeAllNestedDateObjects(await updateTradieSchedule(scheduleId, updates));
        return toToolResult(validated(updateTradieScheduleResponseSchema, res, "tradie schedule response"));
    } catch (error) {
        return toToolError(toolErrorText("Error updating tradie schedule", error));
    }
}

// ---------------------------------------------------------------------------
// Materials & files
// ---------------------------------------------------------------------------

async function add_material(params: In<typeof addMaterialSchema>): Promise<ToolResult> {
    try {
        const res = removeAllNestedDateObjects(await addMaterialToProject(params.projectId, params.materialData));
        return toToolResult(validated(materialResponseSchema, res, "material response"));
    } catch (error) {
        return toToolError(toolErrorText("Error adding material", error));
    }
}

async function upload_file(
    { fileBase64, fileName, fileSize, projectId, milestoneId }: In<typeof uploadFileToolSchema>,
    ctx: ToolContext,
): Promise<ToolResult> {
    try {
        if (!ctx.clerkUserId) {
            throw new Error("Authenticated user is required");
        }
        const fileId = uuid();
        const pathname = buildBlobPath({ fileId, fileName, projectId, milestoneId });
        const file = Buffer.from(fileBase64, "base64");
        const blob = await put(pathname, file, { access: "public" });
        await saveFile({
            userId: ctx.clerkUserId,
            projectId,
            milestoneId: milestoneId ?? undefined,
            fileId,
            fileUrl: blob.url,
            fileName,
            fileType: blob.contentType,
            fileSize,
        });

        return toToolResult(validated(uploadFileResponseSchema, { fileId }, "upload file response"));
    } catch (error) {
        return toToolError(toolErrorText("Error uploading file", error));
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
    create_project,
    create_project_update,
    create_variation,
    update_variation_status,
    get_milestones,
    create_milestone,
    add_milestone_photos,
    update_milestone,
    get_leads,
    create_lead,
    update_lead,
    delete_lead,
    get_all_tradies,
    get_tradie_coordination_dashboard,
    create_tradie_schedule,
    update_tradie_schedule,
    add_material,
    address_council_lookup,
    upload_file,
};

export type ToolHandlerName = keyof typeof TOOL_HANDLERS;
