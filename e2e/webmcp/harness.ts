import assert from "node:assert/strict";

import type { Browser, Page } from "puppeteer";

import { MODEL_CONTEXT_SHIM } from "./shim";

/**
 * Driving the WebMCP surface in a real browser.
 *
 * Everything below `executeTool` is manual verification — nothing can drive
 * ChatGPT Desktop's agent from CI. What *can* be checked automatically is the
 * half that actually rots: which tools a page registers, and whether they still
 * answer. That is what this suite is for.
 *
 * It needs a dev server. `pnpm dev`, then `pnpm test:webmcp`. It is not part of
 * `pnpm test` and must not become part of it: it is slow, it needs a database
 * with real records in it, and a unit suite that silently depends on a running
 * server is a unit suite nobody trusts.
 */

export const BASE_URL = process.env.WEBMCP_BASE_URL ?? "http://localhost:3000";

/** Generous, because a cold Next dev server compiles a route on first request. */
const NAVIGATION_TIMEOUT_MS = 60_000;

/** How long to wait for a screen's tools to appear after navigation. */
const REGISTRATION_TIMEOUT_MS = 20_000;

export type ToolSummary = {
    name: string;
    description?: string;
    inputSchema?: unknown;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
};

export async function launchBrowser(): Promise<Browser> {
    const puppeteer = (await import("puppeteer")).default;
    return puppeteer.launch({ headless: true });
}

/**
 * A page with the shim installed.
 *
 * `evaluateOnNewDocument` runs before any of the app's own script, which is the
 * only ordering that works: `hasWebMcp()` is checked inside an effect on mount,
 * and a shim installed after that has already missed every registration.
 */
export async function openPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(MODEL_CONTEXT_SHIM);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    return page;
}

/**
 * Navigates and waits until the page has registered something.
 *
 * In development `proxy.ts` bounces an unauthenticated request through
 * `/api/dev/sign-in` and back, so there is no login to script — but it does
 * mean the first navigation can redirect twice before settling.
 */
export async function visit(page: Page, path: string): Promise<void> {
    try {
        await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle2" });
    } catch (error) {
        // Otherwise the first thing anyone running this sees is a CDP stack
        // trace ending in ERR_CONNECTION_REFUSED, which says nothing about the
        // one thing they have to do.
        throw new Error(
            `Could not open ${BASE_URL}${path}. Start the dev server with \`pnpm dev\`, `
            + `or point this suite elsewhere with WEBMCP_BASE_URL. `
            + `(${error instanceof Error ? error.message : String(error)})`,
        );
    }

    try {
        await page.waitForFunction(
            async () => ((await document.modelContext?.getTools()) ?? []).length > 0,
            { timeout: REGISTRATION_TIMEOUT_MS },
        );
    } catch {
        throw new Error(
            `No WebMCP tools registered on ${path}. `
            + `Is a dev server running at ${BASE_URL}, and is the signed-in user able to see this page?`,
        );
    }
}

export async function listTools(page: Page): Promise<ToolSummary[]> {
    return page.evaluate(
        async () => (await document.modelContext?.getTools()) ?? [],
    ) as Promise<ToolSummary[]>;
}

export async function toolNames(page: Page): Promise<string[]> {
    return (await listTools(page)).map((tool) => tool.name);
}

/**
 * Runs a tool the way an agent would, through `executeTool`, and parses the
 * result.
 *
 * Not by reaching into the component: the point is to exercise the same path a
 * real agent takes, including the JSON-string arguments the shim passes and the
 * missing options argument that `runToolSafely` has to absorb.
 */
export async function runTool(
    page: Page,
    name: string,
    args: Record<string, unknown> = {},
): Promise<{ isError?: boolean; content?: { text: string }[]; structuredContent?: unknown }> {
    const raw = await page.evaluate(
        async (toolName, input) => {
            const context = document.modelContext;
            if (!context) throw new Error("no modelContext");

            const tools = await context.getTools();
            const tool = tools.find((candidate) => candidate.name === toolName);
            if (!tool) throw new Error(`tool ${toolName} is not registered here`);

            return context.executeTool(tool, JSON.stringify(input));
        },
        name,
        args,
    );

    return JSON.parse(raw as string);
}

/** Asserts a tool answered rather than failing, and returns its payload. */
export async function readTool(
    page: Page,
    name: string,
    args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
    const result = await runTool(page, name, args);
    assert.ok(
        !result.isError,
        `${name} returned an error: ${result.content?.[0]?.text ?? "(no message)"}`,
    );
    assert.ok(
        result.structuredContent,
        `${name} returned no structuredContent; an agent would have nothing to read`,
    );
    return result.structuredContent as Record<string, unknown>;
}

export async function expectTools(page: Page, expected: readonly string[]): Promise<void> {
    const present = await toolNames(page);
    for (const name of expected) {
        assert.ok(
            present.includes(name),
            `${name} should be registered here. Registered: ${present.sort().join(", ")}`,
        );
    }
}

export async function expectToolsAbsent(page: Page, forbidden: readonly string[]): Promise<void> {
    const present = await toolNames(page);
    for (const name of forbidden) {
        assert.ok(
            !present.includes(name),
            `${name} should NOT be registered here, but is`,
        );
    }
}

/**
 * Finds a project to test against by asking the app, rather than by hardcoding
 * an id that only exists in one person's database.
 */
export async function firstProjectId(page: Page): Promise<string> {
    const payload = await readTool(page, "get_project_lookup", { mode: "lookup", limit: 1 });
    const items = payload.items as { id: string; name: string }[] | undefined;
    assert.ok(
        items && items.length > 0,
        "No projects in the database. Seed one before running the WebMCP smoke suite.",
    );
    return items[0].id;
}

export async function firstLeadId(page: Page): Promise<number> {
    const payload = await readTool(page, "get_leads", { limit: 1 });
    const items = payload.items as { id: number; name: string }[] | undefined;
    assert.ok(
        items && items.length > 0,
        "No leads in the database. Seed one before running the WebMCP smoke suite.",
    );
    return items[0].id;
}

/** Tools that were retired in phase two and must not come back anywhere. */
export const RETIRED_TOOLS = [
    "get_projects",
    "get_all_tradies",
    "add_material",
    "create_variation",
    "update_variation_status",
    "leads_set_search",
    "create_project_update",
    "update_milestone",
    "create_tradie_schedule",
    "update_tradie_schedule",
    "upload_file",
    "get_tradie_coordination_dashboard",
] as const;
