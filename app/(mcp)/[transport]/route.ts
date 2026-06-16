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
    tradieScheduleWriteResponseSchema,
    updateLeadSchema,
    updateTradieScheduleResponseSchema,
    updateTradieScheduleSchema,
    variationParamSchema,
    variationResponseSchema,
    leadResponseSchema,
    AddressSuggestion,
    tradiesResponseSchema,
    leadLookupParamSchema,
} from "@/utils/validators";
import { createVariationSchema as createVariationToolSchema } from "@/utils/validators/projects";
import { fetchJson } from "@/utils/fetch";
import { put } from "@vercel/blob"
import { buildBlobPath } from "@/utils/formatters";
import { v4 as uuid } from "uuid";
import { saveFile } from "@/lib/data/file";
import { auth } from '@clerk/nextjs/server'
import { verifyClerkToken } from '@clerk/mcp-tools/next'
import { LeadStage, LeadStageToLeadStageDBMapping } from "@/lib/leads/types";

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

const getTradieResponseSchema = z.object({
    tradies: tradiesResponseSchema,
    totalCount: z.number(),
});

const addressLookupResponseSchema = z.object({
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

const removeAllNestedDateObjects = (value: unknown): unknown => {
    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        return value.map(removeAllNestedDateObjects);
    }

    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, val]) => [
                key,
                removeAllNestedDateObjects(val),
            ])
        );
    }

    return value;
};

const toToolResult = <T>(data: T, noStructuredContent: boolean = false) => {
    const safeData = removeAllNestedDateObjects(data);
    return {
        structuredContent: noStructuredContent ? undefined : safeData as { [key: string]: unknown },
        content: [{ type: "text" as const, text: JSON.stringify(safeData) }],
    };
};

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
                const res = removeAllNestedDateObjects(await getCachedCustomersForDropdown(params.page, params.limit, params.q || params.search));
                const validated = customerLookupResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid customer lookup response", z.treeifyError(validated.error));
                    throw new Error("Invalid customer lookup response");
                }
                return toToolResult(validated.data)
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
                const res = removeAllNestedDateObjects(await getCachedSiteManagersForDropdown(params.page, params.limit, params.q || params.search));
                const validated = siteManagerLookupResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid site manager lookup response", z.treeifyError(validated.error));
                    throw new Error("Invalid site manager lookup response");
                }
                return toToolResult(validated.data)
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
            outputSchema: getTradieResponseSchema,
        },
        async (params) => {
            try {
                const res = removeAllNestedDateObjects(await getTradiesForLookup(params.limit, params.q || params.search))
                const validated = getTradieResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid tradie lookup response", z.treeifyError(validated.error));
                    throw new Error("Invalid tradie lookup response");
                }
                return toToolResult(validated.data)
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
                const res = removeAllNestedDateObjects(await getCachedProjects(params));
                const validated = projectsResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid projects response", z.treeifyError(validated.error));
                    throw new Error("Invalid projects response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await getCachedProjectsForLookup(params.page, params.limit, params.q));
                const validated = projectLookupResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid project lookup response", z.treeifyError(validated.error));
                    throw new Error("Invalid project lookup response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await getCachedProjectById(params.projectId));
                const validated = projectDetailResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid project detail response", z.treeifyError(validated.error));
                    throw new Error("Invalid project detail response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await getCachedProjectById(projectId));
                const validated = projectDetailResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid project detail response", z.treeifyError(validated.error));
                    throw new Error("Invalid project detail response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await getCachedProjectById(params.projectId));
                const validated = projectDetailResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid project detail response", z.treeifyError(validated.error));
                    throw new Error("Invalid project detail response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await createVariation(params.projectId, params));
                const validated = variationResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid variation response", z.treeifyError(validated.error));
                    throw new Error("Invalid variation response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await updateVariationStatus(params.variationId, params.status));
                const validated = variationResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid variation response", z.treeifyError(validated.error));
                    throw new Error("Invalid variation response");
                }
                return toToolResult(validated.data);
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
            outputSchema: z.object({
                milestones: z.array(milestoneResponseSchema),
                totalCount: z.number(),
            }),
        },
        async (params) => {
            try {
                const res = removeAllNestedDateObjects(await getMilestonesByProject(params.projectId)) as Awaited<ReturnType<typeof getMilestonesByProject>>;
                const validated = z.object({
                    milestones: z.array(milestoneResponseSchema),
                    totalCount: z.number(),
                }).safeParse({ milestones: res, totalCount: res.length });
                if (!validated.success) {
                    console.error("Invalid milestones response", z.treeifyError(validated.error));
                    throw new Error("Invalid milestones response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await createMilestone(params.projectId, params));
                const validated = milestoneDetailResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid milestone detail response", z.treeifyError(validated.error));
                    throw new Error("Invalid milestone detail response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await addPhotosToMilestone(params.projectId, params.milestoneId, params.fileIds));
                const validated = milestoneAddPhotosResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid milestone photos response", z.treeifyError(validated.error));
                    throw new Error("Invalid milestone photos response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await updateMilestone(params.milestoneId, params));
                const validated = milestoneUpdateResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid milestone detail response", z.treeifyError(validated.error));
                    throw new Error("Invalid milestone detail response");
                }
                return toToolResult(validated.data);
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
            inputSchema: leadLookupParamSchema,
            outputSchema: leadsResponseSchema,
        },
        async ({ q, status, filterTiming, page, limit }) => {
            try {
                const statusFilterArray = status ? status.split(',').map(s => LeadStageToLeadStageDBMapping[(s.trim() as LeadStage)]) : undefined;
                const res = removeAllNestedDateObjects(await getLeads(page, limit, q, statusFilterArray, filterTiming));
                const validated = leadsResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid leads response", z.treeifyError(validated.error));
                    throw new Error("Invalid leads response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await createLead(params));
                if (res && typeof res === "object" && "message" in res) {
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: String(res.message) }],
                    };
                }
                const validated = leadResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid lead response", z.treeifyError(validated.error));
                    throw new Error("Invalid lead response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await updateLead(Number(leadId), updates));
                const validated = leadResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid lead response", z.treeifyError(validated.error));
                    throw new Error("Invalid lead response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await deleteLead(Number(params.leadId)));
                const validated = deleteLeadResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid delete lead response", z.treeifyError(validated.error));
                    throw new Error("Invalid delete lead response");
                }
                return toToolResult(validated.data);
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
            outputSchema: getTradieResponseSchema,
        },
        async () => {
            try {
                const tradies = removeAllNestedDateObjects(await getCachedTradies()) as Awaited<ReturnType<typeof getCachedTradies>>;
                const payload = { tradies, totalCount: Array.isArray(tradies) ? tradies.length : 0 };
                const validated = getTradieResponseSchema.safeParse(payload);
                if (!validated.success) {
                    console.error("Invalid tradies response", z.treeifyError(validated.error));
                    throw new Error("Invalid tradies response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await getCachedTradieCoordinationDashboard(params));
                const success = tradieCoordinationResponseSchema.safeParse(res);
                if (!success.success) {
                    console.error("Invalid tradie coordination dashboard response", success.error.format());
                    throw new Error("Invalid tradie coordination dashboard response");
                }
                return toToolResult(success.data);
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
                const res = removeAllNestedDateObjects(await createTradieSchedule(params));
                const validated = tradieScheduleWriteResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid tradie schedule response", z.treeifyError(validated.error));
                    throw new Error("Invalid tradie schedule response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await updateTradieSchedule(scheduleId, updates));
                const validated = updateTradieScheduleResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid tradie schedule response", z.treeifyError(validated.error));
                    throw new Error("Invalid tradie schedule response");
                }
                return toToolResult(validated.data);
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
                const res = removeAllNestedDateObjects(await addMaterialToProject(params.projectId, params.materialData));
                const validated = materialResponseSchema.safeParse(res);
                if (!validated.success) {
                    console.error("Invalid material response", z.treeifyError(validated.error));
                    throw new Error("Invalid material response");
                }
                return toToolResult(validated.data);
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
            outputSchema: addressLookupResponseSchema,
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

                const validated = addressLookupResponseSchema.safeParse(data);
                if (!validated.success) {
                    console.error("Invalid address lookup response", z.treeifyError(validated.error));
                    throw new Error("Invalid address lookup response");
                }

                return toToolResult(validated.data);
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
                fileBase64: z.string().describe("Base64 encoded file content"),
                fileName: z.string().describe("Original file name"),
                fileSize: z.number().describe("File size in bytes"),
                projectId: z.string().trim().min(1).describe("The ID of the project to associate the file with"),
                milestoneId: z.string().trim().min(1).optional().describe("The ID of the milestone to associate the file with"),
            }),
            outputSchema: z.object({
                fileId: z.string().describe("The ID of the uploaded file"),
            }),
        },
        async ({ fileBase64, fileName, fileSize, projectId, milestoneId }, { authInfo }) => {
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
                const file = Buffer.from(fileBase64, "base64");
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