"use client";

import { navigationItems } from "@/lib/mock-data";
import { OPERATING_GUIDE } from "@/lib/tools/operating-guide";
import {
    LEAD_DETAIL_TABS,
    NAVIGABLE_PROJECT_TABS,
    leadSurfaceTools,
    projectSurfaceTools,
} from "@/lib/tools/surfaces";

import { callBridgeTool } from "./bridge";
import { webMcpError } from "./tool-result";

/**
 * The tools that only make sense in a browser.
 *
 * Everything in lib/tools/manifest.ts could equally be called by a backend
 * agent over MCP. These cannot: they read and move the UI the human is looking
 * at, which is the whole reason to expose tools through the page rather than
 * only through /api/mcp.
 */

export type CurrentView = {
    pathname: string;
    activeProject?: { id?: string; name?: string } | null;
    activeTradie?: { id?: string; name?: string } | null;
};

export type UiToolDeps = {
    /** Read fresh on each call — the agent may ask long after registration. */
    getView: () => CurrentView;
    navigate: (href: string) => void;
};

const asText = (data: unknown) => ({
    structuredContent: data as Record<string, unknown>,
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
});

/** Sections the agent may navigate to, derived from the real sidebar. */
const SECTIONS = navigationItems.map((item) => item.slug);

type ProjectMatch = { id: string; name: string; location: string | null };

/**
 * Resolves a project named in words through the shared `get_project_lookup`
 * tool, so name resolution in the browser and name resolution over MCP are the
 * same query against the same data.
 *
 * Returns `{ error }` rather than throwing: the caller has better wording for
 * the failure than a generic one would, because it knows what the user asked.
 */
async function lookupProjects(
    query: string,
    signal: AbortSignal,
): Promise<{ items: ProjectMatch[] } | { error: string }> {
    const result = await callBridgeTool(
        "get_project_lookup",
        { mode: "lookup", q: query, limit: 5 },
        { signal },
    );

    if (result.isError) {
        return { error: result.content[0]?.text ?? `Could not search projects for "${query}".` };
    }

    const items = (result.structuredContent as { items?: ProjectMatch[] } | undefined)?.items;
    return { items: items ?? [] };
}

export function createUiTools(deps: UiToolDeps): WebMCP.ModelContextTool[] {
    return [
        {
            name: "get_current_view",
            title: "Get current view",
            description:
                "Returns what the user is currently looking at in the app: the route they are on, and the project or tradie whose detail page is open. Call this first when the user says 'this project', 'this lead' or 'here' so you act on the record in front of them instead of guessing.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true },
            execute: async () => {
                const view = deps.getView();
                return asText({
                    pathname: view.pathname,
                    section: view.pathname.split("/").filter(Boolean)[0] ?? "dashboard",
                    activeProject: view.activeProject
                        ? { id: view.activeProject.id, name: view.activeProject.name }
                        : null,
                    activeTradie: view.activeTradie
                        ? { id: view.activeTradie.id, name: view.activeTradie.name }
                        : null,
                });
            },
        },
        {
            name: "navigate_to",
            title: "Navigate to a section",
            description:
                "Moves the app to one of its sections, optionally to a specific record. Use this to show the user the result of your work rather than only describing it. Does not change any data.",
            inputSchema: {
                type: "object",
                properties: {
                    section: {
                        type: "string",
                        enum: SECTIONS,
                        description: "The section to open.",
                    },
                    id: {
                        type: "string",
                        description:
                            "Optional record id to open within the section, e.g. a project id for 'projects' or a lead id for 'leads'.",
                    },
                },
                required: ["section"],
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: async (input) => {
                const section = String(input.section ?? "");
                // The enum is a hint to the agent, not a guarantee. Anything not
                // on the real sidebar is refused rather than pushed blindly.
                if (!SECTIONS.includes(section)) {
                    return {
                        isError: true,
                        content: [{
                            type: "text" as const,
                            text: `Unknown section "${section}". Available: ${SECTIONS.join(", ")}.`,
                        }],
                    };
                }
                const id = input.id ? String(input.id) : undefined;
                const href = id ? `/${section}/${encodeURIComponent(id)}` : `/${section}`;
                deps.navigate(href);
                return asText({ navigatedTo: href });
            },
        },
        {
            name: "navigate_to_project",
            title: "Open a project",
            description:
                "Opens a project's page, optionally on a particular tab. Pass projectId when you already have one, or query to find a project by name or address \u2014 a query matching several projects returns the candidates and moves nothing, so you can ask which one. Most project tools exist only while a project is open; the result lists what this call makes available.",
            inputSchema: {
                type: "object",
                properties: {
                    projectId: { type: "string", description: "The project to open." },
                    query: {
                        type: "string",
                        description:
                            "Name or address to search for, when you do not have an id. Ignored if projectId is given.",
                    },
                    tab: {
                        type: "string",
                        enum: [...NAVIGABLE_PROJECT_TABS],
                        description: "Which tab to open. Defaults to overview.",
                    },
                },
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: async (input, options) => {
                const tab = input.tab ? String(input.tab) : undefined;
                if (tab && !NAVIGABLE_PROJECT_TABS.includes(tab as never)) {
                    return webMcpError(
                        `Unknown project tab "${tab}". Available: ${NAVIGABLE_PROJECT_TABS.join(", ")}.`,
                    );
                }

                let projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
                let projectName: string | undefined;

                if (!projectId) {
                    const query = typeof input.query === "string" ? input.query.trim() : "";
                    if (!query) {
                        return webMcpError("Pass either projectId or query.");
                    }

                    const matches = await lookupProjects(query, options.signal);
                    if ("error" in matches) return webMcpError(matches.error);

                    if (matches.items.length === 0) {
                        return webMcpError(
                            `No project matches "${query}". Try a shorter query, or list candidates with get_project_lookup.`,
                        );
                    }
                    if (matches.items.length > 1) {
                        // Taking the first match would be a guess the user
                        // cannot see us make, on a page they are about to be
                        // moved to. Hand the choice back instead.
                        return asText({
                            navigated: false,
                            reason: `${matches.items.length} projects match "${query}"`,
                            candidates: matches.items,
                        });
                    }

                    projectId = matches.items[0].id;
                    projectName = matches.items[0].name;
                }

                const href = tab
                    ? `/projects/${encodeURIComponent(projectId)}?activeTab=${tab}`
                    : `/projects/${encodeURIComponent(projectId)}`;
                deps.navigate(href);

                return asText({
                    navigatedTo: href,
                    projectId,
                    ...(projectName ? { projectName } : {}),
                    tab: tab ?? "overview",
                    // The page has not mounted yet, so this is what the tools
                    // *will* be. Re-read your tool list before relying on it.
                    toolsNowAvailable: projectSurfaceTools(tab ?? "overview"),
                });
            },
        },
        {
            name: "navigate_to_lead",
            title: "Open a lead",
            description:
                "Opens a lead's page, optionally on a particular tab. Resolve leadId with get_leads first. Lead tools exist only while a lead is open, and each tab's tools only while that tab is; the result lists what this call makes available.",
            inputSchema: {
                type: "object",
                properties: {
                    leadId: { type: "number", description: "The lead to open, from get_leads." },
                    tab: {
                        type: "string",
                        enum: [...LEAD_DETAIL_TABS],
                        description: "Which tab to open. Defaults to overview.",
                    },
                },
                required: ["leadId"],
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: async (input) => {
                const leadId = Number(input.leadId);
                if (!Number.isFinite(leadId)) {
                    return webMcpError("leadId must be a number. Call get_leads to resolve it.");
                }

                const tab = input.tab ? String(input.tab) : undefined;
                if (tab && !LEAD_DETAIL_TABS.includes(tab as never)) {
                    return webMcpError(
                        `Unknown lead tab "${tab}". Available: ${LEAD_DETAIL_TABS.join(", ")}.`,
                    );
                }

                const href = tab ? `/leads/${leadId}?activeTab=${tab}` : `/leads/${leadId}`;
                deps.navigate(href);

                return asText({
                    navigatedTo: href,
                    leadId,
                    tab: tab ?? "overview",
                    toolsNowAvailable: leadSurfaceTools(tab ?? "overview"),
                });
            },
        },
        {
            name: "get_operating_guide",
            title: "Get operating guide",
            description:
                "Returns the operating guide for this platform: how to resolve record ids, which tool sequences exist for each workflow, and the rules for writes. Read this before your first write operation.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true },
            execute: async () => ({
                content: [{ type: "text" as const, text: OPERATING_GUIDE }],
            }),
        },
    ];
}
