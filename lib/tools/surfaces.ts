import { VISIBLE_PROJECT_DETAIL_TABS } from "@/components/projects/detail/project-tab-navigation";
import { LEAD_DETAIL_TABS } from "@/components/leads/detail/lead-tab-navigation";

// Re-exported so a caller needing both the tabs and the tools they carry has
// one import, and cannot pick up a tab list from somewhere that disagrees.
export { LEAD_DETAIL_TABS, VISIBLE_PROJECT_DETAIL_TABS };

/**
 * Which tools exist on which screen.
 *
 * Screen-registered tools are the point of WebMCP here, but they create a
 * problem the shared manifest does not have: the agent cannot discover a tool
 * it cannot yet see. Telling it "navigate first" is only useful if something
 * says what navigating will get it — and the moment that list is written down
 * twice (once in a navigation tool's answer, once in the operating guide) the
 * two start drifting apart the first time a tool moves.
 *
 * So it is written down once, here, and read by both. The Puppeteer smoke suite
 * asserts the lists against what a real page actually registers, which is what
 * keeps this file honest rather than aspirational.
 *
 * Client-safe: names and arrays only.
 */

/** Available on every authenticated page: the shared manifest plus the UI tools. */
export const GLOBAL_TOOLS = [
    "get_leads",
    "get_project_lookup",
    "get_project",
    "get_customer",
    "get_site_managers",
    "get_tradies",
    "address_council_lookup",
    "get_current_view",
    "get_operating_guide",
    "navigate_to",
    "navigate_to_lead",
    "navigate_to_project",
] as const;

export const LEADS_LIST_TOOLS = [
    "leads_filter_by_stage",
    "create_lead",
    "update_lead",
    "delete_lead",
] as const;

/** On a lead's page whatever tab is open. */
export const LEAD_DETAIL_TOOLS = [
    "navigate_to_lead_tab",
    "upload_lead_files",
] as const;

/** Keyed by the tab, because only the open tab's panel is mounted. */
export const LEAD_TAB_TOOLS: Record<(typeof LEAD_DETAIL_TABS)[number], readonly string[]> = {
    overview: [],
    scheduledWork: [],
    documents: [],
    notes: [],
};

export const PROJECTS_LIST_TOOLS = ["start_project_creation"] as const;

/** On a project's page whatever tab is open. */
export const PROJECT_DETAIL_TOOLS = [
    "navigate_to_project_tab",
    "get_project_warnings",
    "create_milestone",
    "update_milestone",
    "add_milestone_photos",
    "upload_project_files",
    "create_tradie_schedule",
] as const;

/**
 * The project tabs an agent may navigate to.
 *
 * Narrower than VISIBLE_PROJECT_DETAIL_TABS on purpose: `payments` still renders
 * a panel for an admin, but its trigger is commented out in
 * project-tab-navigation.tsx, so anything sent there has no way back except the
 * browser's own history. Offering a one-way door is worse than not offering it.
 */
export const NAVIGABLE_PROJECT_TABS = VISIBLE_PROJECT_DETAIL_TABS.filter(
    (tab) => tab !== "payments",
);

export const PROJECT_TAB_TOOLS: Record<
    (typeof VISIBLE_PROJECT_DETAIL_TABS)[number],
    readonly string[]
> = {
    overview: ["get_project_overview_details"],
    milestones: ["get_milestones"],
    payments: [],
    tradies: [],
    docs: ["get_project_files"],
    history: [],
    communications: [],
};

/** Everything reachable on a lead's page with `tab` open. */
export function leadSurfaceTools(tab?: string): string[] {
    const tabTools = tab && tab in LEAD_TAB_TOOLS
        ? LEAD_TAB_TOOLS[tab as keyof typeof LEAD_TAB_TOOLS]
        : [];
    return [...LEAD_DETAIL_TOOLS, ...tabTools];
}

/** Everything reachable on a project's page with `tab` open. */
export function projectSurfaceTools(tab?: string): string[] {
    const tabTools = tab && tab in PROJECT_TAB_TOOLS
        ? PROJECT_TAB_TOOLS[tab as keyof typeof PROJECT_TAB_TOOLS]
        : [];
    return [...PROJECT_DETAIL_TOOLS, ...tabTools];
}
