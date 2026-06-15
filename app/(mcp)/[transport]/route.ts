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
import { fetchJson } from "@/utils/fetch";
import { put } from "@vercel/blob"
import { buildBlobPath } from "@/utils/formatters";
import { v4 as uuid } from "uuid";
import { saveFile } from "@/lib/data/file";
import { auth } from '@clerk/nextjs/server'
import { verifyClerkToken } from '@clerk/mcp-tools/next'

const emptyInputSchema = z.object({}).strict();

const projectUpdateToolSchema = projectParamSchema.extend(createProjectUpdateSchema.shape);
const projectCreateToolSchema = createProjectSchema;
const leadUpdateToolSchema = leadParamSchema.extend(updateLeadSchema.shape);
const leadDeleteToolSchema = leadParamSchema;
const milestoneCreateToolSchema = projectParamSchema.extend(milestoneCreationSchema.shape);
const milestoneUpdateToolSchema = milestoneParamSchema.extend(milestoneUpdateSchema.shape);
const addPhotosToolSchema = z.object({
    projectId: z.string().trim().min(1),
    milestoneId: z.string().trim().min(1),
    fileIds: z.array(z.string().trim().min(1)).min(1),
});
const variationCreateToolSchema = projectParamSchema.extend(createVariationToolSchema.shape);
const variationUpdateToolSchema = variationParamSchema.extend({ status: z.enum(["APPROVED", "REJECTED"]) });
const tradieScheduleUpdateToolSchema = scheduleParamSchema.extend(updateTradieScheduleSchema.shape);

const toToolResult = <T>(data: T) => ({
    // structuredContent: data as { [key: string]: unknown },
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
        async (params) => {
            try {
                return toToolResult(await getCachedCustomersForDropdown(params.page, params.limit, params.q || params.search))
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching customers ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_site_managers",
        {
            description: "List site managers for assignment",
            inputSchema: siteManagerLookupQuerySchema,
            outputSchema: siteManagerLookupResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await getCachedSiteManagersForDropdown(params.page, params.limit, params.q || params.search))
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching site managers ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_tradies",
        {
            description: "Search tradies for dropdowns and lookup",
            inputSchema: tradieSearchQuerySchema,
            outputSchema: tradiesResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await getTradiesForLookup(params.limit, params.q || params.search))
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching tradies ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_projects",
        {
            description: "List projects with stats",
            inputSchema: projectListQuerySchema,
            outputSchema: projectsResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await getCachedProjects(params));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching projects ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_project_lookup",
        {
            description: "Lookup projects for dropdowns",
            inputSchema: projectLookupQuerySchema,
            outputSchema: projectLookupResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await getCachedProjectsForLookup(params.page, params.limit, params.q));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching projects for lookup ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_project",
        {
            description: "Get a project by id",
            inputSchema: projectParamSchema,
            outputSchema: projectDetailResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await getCachedProjectById(params.projectId));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching project ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "create_project",
        {
            description: "Create a new project",
            inputSchema: projectCreateToolSchema,
            outputSchema: projectDetailResponseSchema,
        },
        async (params) => {
            try {
                const projectId = await createProject(params);
                return toToolResult(await getCachedProjectById(projectId));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error creating project ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "create_project_update",
        {
            description: "Create a site update for a project",
            inputSchema: projectUpdateToolSchema,
            outputSchema: projectDetailResponseSchema,
        },
        async (params, { authInfo }) => {
            const clerkId = authInfo?.extra?.userId as string | undefined;
            try {
                if (!clerkId) {
                    throw new Error("Authenticated user is required");
                }

                const user = await getUserByClerkIdCached(clerkId);
                if (!user) {
                    throw new Error("User not found");
                }
                await createProjectUpdate({ ...params, authorId: user.id });
                return toToolResult(await getCachedProjectById(params.projectId));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error creating project update ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "create_variation",
        {
            description: "Create a project variation",
            inputSchema: variationCreateToolSchema,
            outputSchema: variationResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await createVariation(params.projectId, params));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error creating variation ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "update_variation_status",
        {
            description: "Approve or reject a variation",
            inputSchema: variationUpdateToolSchema,
            outputSchema: variationResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await updateVariationStatus(params.variationId, params.status));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error updating variation status ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_milestones",
        {
            description: "List milestones for a project",
            inputSchema: projectParamSchema,
            outputSchema: z.array(milestoneResponseSchema),
        },
        async (params) => {
            try {
                return toToolResult(await getMilestonesByProject(params.projectId));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching milestones ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "create_milestone",
        {
            description: "Create a milestone for a project",
            inputSchema: milestoneCreateToolSchema,
            outputSchema: milestoneDetailResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await createMilestone(params.projectId, params));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error creating milestone ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "add_milestone_photos",
        {
            description: "Attach uploaded files to a milestone",
            inputSchema: addPhotosToolSchema,
            outputSchema: milestoneAddPhotosResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await addPhotosToMilestone(params.projectId, params.milestoneId, params.fileIds));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error adding milestone photos ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "update_milestone",
        {
            description: "Update milestone status and dates",
            inputSchema: milestoneUpdateToolSchema,
            outputSchema: milestoneUpdateResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await updateMilestone(params.milestoneId, params));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error updating milestone ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_leads",
        {
            description: "List all leads",
            inputSchema: emptyInputSchema,
            outputSchema: leadsResponseSchema,
        },
        async () => {
            try {
                return toToolResult(await getLeads());
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching leads ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "create_lead",
        {
            description: "Create a new lead",
            inputSchema: createLeadSchema,
            outputSchema: leadResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await createLead(params));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error creating lead ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "update_lead",
        {
            description: "Update an existing lead",
            inputSchema: leadUpdateToolSchema,
            outputSchema: leadResponseSchema,
        },
        async (params) => {
            try {
                const { leadId, ...updates } = params;
                return toToolResult(await updateLead(Number(leadId), updates));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error updating lead ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "delete_lead",
        {
            description: "Delete a lead",
            inputSchema: leadDeleteToolSchema,
            outputSchema: deleteLeadResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await deleteLead(Number(params.leadId)));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error deleting lead ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_all_tradies",
        {
            description: "List all tradies for scheduling",
            inputSchema: emptyInputSchema,
            outputSchema: tradiesResponseSchema,
        },
        async () => {
            try {
                return toToolResult(await getCachedTradies());
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching tradies ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "get_tradie_coordination_dashboard",
        {
            description: "Get tradie coordination dashboard data",
            inputSchema: tradieCoordinationListQuerySchema,
            outputSchema: tradieCoordinationResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await getCachedTradieCoordinationDashboard(params));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching tradie coordination data ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "create_tradie_schedule",
        {
            description: "Create a tradie schedule",
            inputSchema: createTradieScheduleSchema,
            outputSchema: tradieScheduleWriteResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await createTradieSchedule(params));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error creating tradie schedule ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "update_tradie_schedule",
        {
            description: "Update a tradie schedule",
            inputSchema: tradieScheduleUpdateToolSchema,
            outputSchema: updateTradieScheduleResponseSchema,
        },
        async (params) => {
            try {
                const { scheduleId, ...updates } = params;
                return toToolResult(await updateTradieSchedule(scheduleId, updates));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error updating tradie schedule ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
    );

    server.registerTool(
        "add_material",
        {
            description: "Add material to a project",
            inputSchema: addMaterialSchema,
            outputSchema: materialResponseSchema,
        },
        async (params) => {
            try {
                return toToolResult(await addMaterialToProject(params.projectId, params.materialData));
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error adding material ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        },
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
            try {
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

                return toToolResult(data);
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error fetching address suggestions ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
        }
    );

    server.registerTool(
        "upload_file",
        {
            description: "Upload a file and get back its ID for association with milestones and projects",
            inputSchema: z.object({
                file: z.string().describe("Base64 encoded file content"),
                fileName: z.string().describe("Original file name"),
                fileSize: z.number().describe("File size in bytes"),
                projectId: z.string().trim().min(1).describe("The ID of the project to associate the file with"),
                milestoneId: z.string().trim().min(1).optional().describe("The ID of the milestone to associate the file with"),
            }),
            outputSchema: z.object({
                fileId: z.string().describe("The ID of the uploaded file"),
            }),
        },
        async ({ file, fileName, fileSize, projectId, milestoneId }, { authInfo }) => {
            const userId = authInfo?.extra?.userId as string | undefined;
            try {
                if (!userId) {
                    throw new Error("Authenticated user is required");
                }
                const fileId = uuid();
                const pathname = buildBlobPath({
                    fileId: fileId,
                    fileName: fileName,
                    projectId,
                    milestoneId,
                });
                const blob = await put(pathname, file, { access: "public" });
                await saveFile({
                    userId,
                    projectId: projectId,
                    milestoneId: milestoneId ?? undefined,
                    fileId: fileId,
                    fileUrl: blob.url,
                    fileName: fileName,
                    fileType: blob.contentType,
                    fileSize: fileSize,
                });

                return toToolResult({ fileId });
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: `Error uploading file ${error instanceof Error ? error.message : String(error)}` }],
                }
            }
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