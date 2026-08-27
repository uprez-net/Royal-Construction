import { z } from "zod";

import {
    createLeadSchema,
    leadLookupParamSchema,
    leadParamSchema,
    updateLeadSchema,
} from "@/utils/validators/lead";
import {
    customerLookupQuerySchema,
    siteManagerLookupQuerySchema,
} from "@/utils/validators/lookups";
import { addMaterialSchema } from "@/utils/validators/material";
import {
    milestoneCreationSchema,
    milestoneUpdateSchema,
} from "@/utils/validators/milestone";
import {
    createProjectSchema,
    createProjectUpdateSchema,
    createVariationSchema,
    milestoneParamSchema,
    projectListQuerySchema,
    projectLookupQuerySchema,
    projectParamSchema,
    variationParamSchema,
} from "@/utils/validators/projects";
import {
    createTradieScheduleSchema,
    scheduleParamSchema,
    tradieCoordinationListQuerySchema,
    tradieSearchQuerySchema,
    updateTradieScheduleSchema,
} from "@/utils/validators/tradies";
import {
    customerLookupResponseSchema,
    deleteLeadResponseSchema,
    leadResponseSchema,
    leadsResponseSchema,
    materialResponseSchema,
    milestoneAddPhotosResponseSchema,
    milestoneDetailResponseSchema,
    milestoneResponseSchema,
    milestoneUpdateResponseSchema,
    projectDetailResponseSchema,
    projectLookupResponseSchema,
    projectsResponseSchema,
    siteManagerLookupResponseSchema,
    tradieCoordinationResponseSchema,
    tradiesResponseSchema,
    tradieScheduleWriteResponseSchema,
    updateTradieScheduleResponseSchema,
    variationResponseSchema,
} from "@/utils/validators/mcp";

import type { ToolDescriptor } from "./types";

// ---------------------------------------------------------------------------
// Composite schemas
//
// These used to live at the top of app/(mcp)/api/mcp/route.ts. They belong with
// the manifest now, because both transports need the identical shape.
// ---------------------------------------------------------------------------

export const emptyInputSchema = z.object({}).strict();

export const projectUpdateToolSchema = projectParamSchema.extend(createProjectUpdateSchema.shape);
export const projectCreateToolSchema = createProjectSchema;
export const leadUpdateToolSchema = leadParamSchema.extend(updateLeadSchema.shape);
export const leadDeleteToolSchema = leadParamSchema;
export const milestoneCreateToolSchema = projectParamSchema.extend(milestoneCreationSchema.shape);
export const milestoneUpdateToolSchema = milestoneParamSchema.extend(milestoneUpdateSchema.shape);
export const addPhotosToolSchema = z.object({
    projectId: z.string().trim().min(1),
    milestoneId: z.string().trim().min(1),
    fileIds: z.array(z.string().trim().min(1)).min(1),
});
export const variationCreateToolSchema = projectParamSchema.extend(createVariationSchema.shape);
export const variationUpdateToolSchema = variationParamSchema.extend({
    status: z.enum(["APPROVED", "REJECTED"]),
});
export const tradieScheduleUpdateToolSchema = scheduleParamSchema.extend(updateTradieScheduleSchema.shape);

/**
 * Was an inline ZodRawShape in the route. Promoted to a ZodObject so every
 * manifest entry converts to JSON Schema through the same code path; the MCP
 * SDK accepts either form and derives the same schema from both.
 */
export const addressLookupToolSchema = z.object({
    query: z.string().describe("The address to look up"),
    limit: z.number().optional().describe("Max number of results"),
});

export const uploadFileToolSchema = z.object({
    fileBase64: z.string().describe("Base64 encoded file content"),
    fileName: z.string().describe("Original file name"),
    fileSize: z.number().describe("File size in bytes"),
    projectId: z.string().trim().min(1).describe("The ID of the project to associate the file with"),
    milestoneId: z.string().trim().min(1).optional().describe("The ID of the milestone to associate the file with"),
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

export const uploadFileResponseSchema = z.object({
    fileId: z.string().describe("The ID of the uploaded file"),
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
// the lead, project, milestone and coordination payloads.
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
        name: "create_project",
        description: "Create a new project",
        inputSchema: projectCreateToolSchema,
        outputSchema: projectDetailResponseSchema,
        annotations: { readOnlyHint: false },
        surface: "both",
    },
    {
        name: "create_project_update",
        description: "Create a site update for a project",
        inputSchema: projectUpdateToolSchema,
        outputSchema: projectDetailResponseSchema,
        annotations: { readOnlyHint: false },
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
        name: "create_milestone",
        description: "Create a milestone for a project",
        inputSchema: milestoneCreateToolSchema,
        outputSchema: milestoneDetailResponseSchema,
        annotations: { readOnlyHint: false },
        surface: "both",
    },
    {
        name: "add_milestone_photos",
        description: "Attach uploaded files to a milestone",
        inputSchema: addPhotosToolSchema,
        outputSchema: milestoneAddPhotosResponseSchema,
        annotations: { readOnlyHint: false },
        surface: "both",
    },
    {
        name: "update_milestone",
        description: "Update milestone status and dates",
        inputSchema: milestoneUpdateToolSchema,
        outputSchema: milestoneUpdateResponseSchema,
        annotations: { readOnlyHint: false },
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
        name: "create_lead",
        description: "Create a new lead",
        inputSchema: createLeadSchema,
        outputSchema: leadResponseSchema,
        annotations: { readOnlyHint: false },
        surface: "both",
    },
    {
        name: "update_lead",
        description: "Update an existing lead",
        inputSchema: leadUpdateToolSchema,
        outputSchema: leadResponseSchema,
        annotations: { readOnlyHint: false },
        surface: "both",
    },
    {
        name: "delete_lead",
        description: "Delete a lead",
        inputSchema: leadDeleteToolSchema,
        outputSchema: deleteLeadResponseSchema,
        annotations: { readOnlyHint: false },
        // Irreversible. Not reachable by a non-admin session.
        requiredRole: "ADMIN",
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
        name: "get_tradie_coordination_dashboard",
        description: "Get tradie coordination dashboard data",
        inputSchema: tradieCoordinationListQuerySchema,
        outputSchema: tradieCoordinationResponseSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        surface: "both",
    },
    {
        name: "create_tradie_schedule",
        description: "Create a tradie schedule",
        inputSchema: createTradieScheduleSchema,
        outputSchema: tradieScheduleWriteResponseSchema,
        annotations: { readOnlyHint: false },
        surface: "both",
    },
    {
        name: "update_tradie_schedule",
        description: "Update a tradie schedule",
        inputSchema: tradieScheduleUpdateToolSchema,
        outputSchema: updateTradieScheduleResponseSchema,
        annotations: { readOnlyHint: false },
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
    {
        name: "upload_file",
        description: "Upload a file and get back its ID for association with milestones and projects",
        inputSchema: uploadFileToolSchema,
        outputSchema: uploadFileResponseSchema,
        annotations: { readOnlyHint: false },
        // Server-only: takes the file as base64 in its arguments, which a
        // browser agent has no way to produce. components/webmcp/ui-tools.ts
        // exposes pick_and_upload_file instead, which opens the real picker.
        surface: "server",
    },
];

export const TOOL_NAMES = TOOL_MANIFEST.map((tool) => tool.name);

export function findTool(name: string): ToolDescriptor | undefined {
    return TOOL_MANIFEST.find((tool) => tool.name === name);
}
