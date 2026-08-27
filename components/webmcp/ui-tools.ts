"use client";

import { navigationItems } from "@/lib/mock-data";
import { OPERATING_GUIDE } from "@/lib/tools/operating-guide";

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

export function createUiTools(deps: UiToolDeps): ModelContextTool[] {
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
