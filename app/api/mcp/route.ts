import { verifyToken as clerkTokenVerification } from "@clerk/nextjs/server";
import { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import { getCachedCustomersForDropdown } from "@/lib/data/customers";
import { getLeads, createLead, updateLead, deleteLead } from "@/lib/data/leads";
import { addMaterialToProject } from "@/lib/data/material";
import { addPhotosToMilestone, createMilestone, getMilestonesByProject, updateMilestone } from "@/lib/data/milestones";
import { createProjectUpdate } from "@/lib/data/projectUpdates";
import { getCachedProjectById, getCachedProjects, getCachedProjectsForLookup } from "@/lib/data/projects";
import { createProject } from "@/lib/data/projectsWrite";
import { getCachedSiteManagersForDropdown } from "@/lib/data/siteManagers";
import { createTradieSchedule, updateTradieSchedule } from "@/lib/data/tradieSchedules";
import { getCachedTradieCoordinationDashboard, getCachedTradies, getTradiesForLookup } from "@/lib/data/tradies";
import { createVariation, updateVariationStatus } from "@/lib/data/variations";
import { getUserByClerkIdCached } from "@/lib/data/user";
import {
    addMaterialSchema,
    createLeadSchema,
    createProjectSchema,
    createProjectUpdateSchema,
    createTradieScheduleSchema,
    customerLookupQuerySchema,
    customerLookupResponseSchema,
    deleteLeadResponseSchema,
    leadParamSchema,
    leadsResponseSchema,
    materialResponseSchema,
    milestoneAddPhotosResponseSchema,
    milestoneCreationSchema,
    milestoneDetailResponseSchema,
    milestoneParamSchema,
    milestoneResponseSchema,
    milestoneUpdateResponseSchema,
    milestoneUpdateSchema,
    projectDetailResponseSchema,
    projectListQuerySchema,
    projectLookupQuerySchema,
    projectLookupResponseSchema,
    projectParamSchema,
    projectsResponseSchema,
    scheduleParamSchema,
    siteManagerLookupQuerySchema,
    siteManagerLookupResponseSchema,
    tradieCoordinationListQuerySchema,
    tradieCoordinationResponseSchema,
    tradieSearchQuerySchema,
    tradiesResponseSchema,
    tradieScheduleWriteResponseSchema,
    updateLeadSchema,
    updateTradieScheduleResponseSchema,
    updateTradieScheduleSchema,
    variationParamSchema,
    variationResponseSchema,
    leadResponseSchema,
    AddressSuggestion,
} from "@/utils/validators";
import { createVariationSchema as createVariationToolSchema } from "@/utils/validators/projects";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp";
import { fetchJson } from "@/utils/fetch";

const emptyInputSchema = z.object({}).strict();

const projectUpdateToolSchema = projectParamSchema.merge(createProjectUpdateSchema);
const projectCreateToolSchema = createProjectSchema;
const leadUpdateToolSchema = leadParamSchema.merge(updateLeadSchema);
const leadDeleteToolSchema = leadParamSchema;
const milestoneCreateToolSchema = projectParamSchema.merge(milestoneCreationSchema);
const milestoneUpdateToolSchema = milestoneParamSchema.merge(milestoneUpdateSchema);
const addPhotosToolSchema = z.object({
    projectId: z.string().trim().min(1),
    milestoneId: z.string().trim().min(1),
    fileIds: z.array(z.string().trim().min(1)).min(1),
});
const variationCreateToolSchema = projectParamSchema.merge(createVariationToolSchema);
const variationUpdateToolSchema = variationParamSchema.merge(z.object({ status: z.enum(["APPROVED", "REJECTED"]) }));
const tradieScheduleUpdateToolSchema = scheduleParamSchema.merge(updateTradieScheduleSchema);

const toToolResult = <T>(data: T) => ({
    structuredContent: data as { [key: string]: unknown },
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

const handler = createMcpHandler((server) => {
    server.registerTool(
        "get_customer",
        {
            description: "Get customer information for project creation",
            inputSchema: customerLookupQuerySchema,
            outputSchema: customerLookupResponseSchema,
        },
        async (params) => toToolResult(await getCachedCustomersForDropdown(params.page, params.limit, params.q || params.search)),
    );

    server.registerTool(
        "get_site_managers",
        {
            description: "List site managers for assignment",
            inputSchema: siteManagerLookupQuerySchema,
            outputSchema: siteManagerLookupResponseSchema,
        },
        async (params) => toToolResult(await getCachedSiteManagersForDropdown(params.page, params.limit, params.q || params.search)),
    );

    server.registerTool(
        "get_tradies",
        {
            description: "Search tradies for dropdowns and lookup",
            inputSchema: tradieSearchQuerySchema,
            outputSchema: tradiesResponseSchema,
        },
        async (params) => toToolResult(await getTradiesForLookup(params.limit, params.q || params.search)),
    );

    server.registerTool(
        "get_projects",
        {
            description: "List projects with stats",
            inputSchema: projectListQuerySchema,
            outputSchema: projectsResponseSchema,
        },
        async (params) => toToolResult(await getCachedProjects(params)),
    );

    server.registerTool(
        "get_project_lookup",
        {
            description: "Lookup projects for dropdowns",
            inputSchema: projectLookupQuerySchema,
            outputSchema: projectLookupResponseSchema,
        },
        async (params) => toToolResult(await getCachedProjectsForLookup(params.page, params.limit, params.q)),
    );

    server.registerTool(
        "get_project",
        {
            description: "Get a project by id",
            inputSchema: projectParamSchema,
            outputSchema: projectDetailResponseSchema,
        },
        async (params) => toToolResult(await getCachedProjectById(params.projectId)),
    );

    server.registerTool(
        "create_project",
        {
            description: "Create a new project",
            inputSchema: projectCreateToolSchema,
            outputSchema: projectDetailResponseSchema,
        },
        async (params) => {
            const projectId = await createProject(params);
            return toToolResult(await getCachedProjectById(projectId));
        },
    );

    server.registerTool(
        "create_project_update",
        {
            description: "Create a site update for a project",
            inputSchema: projectUpdateToolSchema,
            outputSchema: projectDetailResponseSchema,
        },
        async (params, extra) => {
            const clerkId = extra.authInfo?.extra?.userId as string | undefined;
            if (!clerkId) {
                throw new Error("Authenticated user is required");
            }

            const user = await getUserByClerkIdCached(clerkId);
            if (!user) {
                throw new Error("User not found");
            }

            await createProjectUpdate({ ...params, authorId: user.id });
            return toToolResult(await getCachedProjectById(params.projectId));
        },
    );

    server.registerTool(
        "create_variation",
        {
            description: "Create a project variation",
            inputSchema: variationCreateToolSchema,
            outputSchema: variationResponseSchema,
        },
        async (params) => toToolResult(await createVariation(params.projectId, params)),
    );

    server.registerTool(
        "update_variation_status",
        {
            description: "Approve or reject a variation",
            inputSchema: variationUpdateToolSchema,
            outputSchema: variationResponseSchema,
        },
        async (params) => toToolResult(await updateVariationStatus(params.variationId, params.status)),
    );

    server.registerTool(
        "get_milestones",
        {
            description: "List milestones for a project",
            inputSchema: projectParamSchema,
            outputSchema: z.array(milestoneResponseSchema),
        },
        async (params) => toToolResult(await getMilestonesByProject(params.projectId)),
    );

    server.registerTool(
        "create_milestone",
        {
            description: "Create a milestone for a project",
            inputSchema: milestoneCreateToolSchema,
            outputSchema: milestoneDetailResponseSchema,
        },
        async (params) => toToolResult(await createMilestone(params.projectId, params)),
    );

    server.registerTool(
        "add_milestone_photos",
        {
            description: "Attach uploaded files to a milestone",
            inputSchema: addPhotosToolSchema,
            outputSchema: milestoneAddPhotosResponseSchema,
        },
        async (params) => toToolResult(await addPhotosToMilestone(params.projectId, params.milestoneId, params.fileIds)),
    );

    server.registerTool(
        "update_milestone",
        {
            description: "Update milestone status and dates",
            inputSchema: milestoneUpdateToolSchema,
            outputSchema: milestoneUpdateResponseSchema,
        },
        async (params) => toToolResult(await updateMilestone(params.milestoneId, params)),
    );

    server.registerTool(
        "get_leads",
        {
            description: "List all leads",
            inputSchema: emptyInputSchema,
            outputSchema: leadsResponseSchema,
        },
        async () => toToolResult(await getLeads()),
    );

    server.registerTool(
        "create_lead",
        {
            description: "Create a new lead",
            inputSchema: createLeadSchema,
            outputSchema: leadResponseSchema,
        },
        async (params) => toToolResult(await createLead(params)),
    );

    server.registerTool(
        "update_lead",
        {
            description: "Update an existing lead",
            inputSchema: leadUpdateToolSchema,
            outputSchema: leadResponseSchema,
        },
        async (params) => {
            const { leadId, ...updates } = params;
            return toToolResult(await updateLead(Number(leadId), updates));
        },
    );

    server.registerTool(
        "delete_lead",
        {
            description: "Delete a lead",
            inputSchema: leadDeleteToolSchema,
            outputSchema: deleteLeadResponseSchema,
        },
        async (params) => toToolResult(await deleteLead(Number(params.leadId))),
    );

    server.registerTool(
        "get_all_tradies",
        {
            description: "List all tradies for scheduling",
            inputSchema: emptyInputSchema,
            outputSchema: tradiesResponseSchema,
        },
        async () => toToolResult(await getCachedTradies()),
    );

    server.registerTool(
        "get_tradie_coordination_dashboard",
        {
            description: "Get tradie coordination dashboard data",
            inputSchema: tradieCoordinationListQuerySchema,
            outputSchema: tradieCoordinationResponseSchema,
        },
        async (params) => toToolResult(await getCachedTradieCoordinationDashboard(params)),
    );

    server.registerTool(
        "create_tradie_schedule",
        {
            description: "Create a tradie schedule",
            inputSchema: createTradieScheduleSchema,
            outputSchema: tradieScheduleWriteResponseSchema,
        },
        async (params) => toToolResult(await createTradieSchedule(params)),
    );

    server.registerTool(
        "update_tradie_schedule",
        {
            description: "Update a tradie schedule",
            inputSchema: tradieScheduleUpdateToolSchema,
            outputSchema: updateTradieScheduleResponseSchema,
        },
        async (params) => {
            const { scheduleId, ...updates } = params;
            return toToolResult(await updateTradieSchedule(scheduleId, updates));
        },
    );

    server.registerTool(
        "add_material",
        {
            description: "Add material to a project",
            inputSchema: addMaterialSchema,
            outputSchema: materialResponseSchema,
        },
        async (params) => toToolResult(await addMaterialToProject(params.projectId, params.materialData)),
    );
    server.registerTool(
        "address_council_lookup",
        {
            title: "Address Council Lookup",
            description: "Lookup council information based on address",
            inputSchema: {
                query: z.string().describe("The address to look up"),
                limit: z.number().optional().describe("Max number of results"),
            },
        },
        async ({ query, limit }) => {
            const trimmedQuery = query.trim();

            const response = await fetchJson<{
                suggestions: AddressSuggestion[];
                count: number;
            }>(
                `/api/address?query=${encodeURIComponent(trimmedQuery)}&limit=${limit ?? 5}`,
                { method: "GET" },
                "Error fetching location suggestions"
            );

            const data = response.data;

            return {
                content: [{ type: "text", text: JSON.stringify(data) }],
            };
        }
    );
},
    {
        serverInfo: {
            name: "MCP Royal Construction",
            version: "1.0.0",
        },
    },
    {
        basePath: "/api/mcp",
    });

const verifyToken = async (
    req: Request,
    bearerToken?: string,
): Promise<AuthInfo | undefined> => {
    if (!bearerToken) return undefined;

    try {
        const payload = await clerkTokenVerification(bearerToken, {});

        return {
            token: bearerToken,
            clientId: payload.sub,
            scopes: ["read:stuff"],
            extra: payload,
        };
    } catch {
        return undefined;
    }
};

const authHandler = withMcpAuth(handler, verifyToken, {
    required: true,
    requiredScopes: ["read:stuff"],
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };