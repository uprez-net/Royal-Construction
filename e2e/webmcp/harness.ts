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
const REGISTRATION_TIMEOUT_MS = 30_000;

/**
 * The dev sign-in exchanges a ticket in the browser and then redirects itself,
 * which takes five to ten seconds against a cold dev server.
 */
const SIGN_IN_TIMEOUT_MS = 90_000;

/** Sign-in is retried: a failed ticket exchange is transient, not structural. */
const SIGN_IN_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pathOf = (url: string) => {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
};

/** True while the browser is somewhere in the sign-in dance rather than the app. */
const isAuthPath = (url: string) => {
    const path = pathOf(url);
    return path.startsWith("/dev/sign-in") || path.startsWith("/sign-in") || path === "about:blank";
};

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
 * Establishes a session, once, before any test navigates.
 *
 * This has to go through `/api/dev/sign-in` explicitly. Letting `proxy.ts`
 * bounce an unauthenticated request there instead ends in
 * ERR_TOO_MANY_REDIRECTS: the redirect chain is resolved by the browser before
 * any of the page's own script runs, and the ticket exchange that would break
 * the loop is client-side.
 *
 * The wait is polled from Node rather than with `waitForFunction`, because the
 * page navigates itself twice while we are watching and an in-page predicate
 * dies with the execution context each time.
 */
export async function signIn(page: Page, attempt = 1): Promise<void> {
    try {
        await page.goto(`${BASE_URL}/api/dev/sign-in?redirect_url=%2Fdashboard`, {
            waitUntil: "domcontentloaded",
        });
    } catch (error) {
        // A redirect loop here is transient: it means the ticket did not take,
        // and minting a fresh one usually works. Clerk development instances
        // have strict usage limits, so a burst of sign-ins can trip it.
        if (attempt < SIGN_IN_ATTEMPTS) {
            await sleep(2000 * attempt);
            return signIn(page, attempt + 1);
        }

        throw new Error(
            `Could not sign in at ${BASE_URL} after ${SIGN_IN_ATTEMPTS} attempts. `
            + `Start the dev server with \`pnpm dev\`, or point this suite elsewhere `
            + `with WEBMCP_BASE_URL. `
            + `(${error instanceof Error ? error.message : String(error)})`,
        );
    }

    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (!isAuthPath(page.url())) return;
        await sleep(500);
    }

    if (attempt < SIGN_IN_ATTEMPTS) {
        await sleep(2000 * attempt);
        return signIn(page, attempt + 1);
    }

    throw new Error(
        `Dev sign-in did not complete; still at ${page.url()}. `
        + "Is DEV_AUTO_SIGN_IN enabled, and does DEV_AUTH_CLERK_USER_ID name a real user?",
    );
}

/**
 * Navigates and waits until the page has registered something.
 *
 * A session that lapses mid-run drops the browser back on the sign-in page,
 * where nothing registers and every later assertion fails for a reason that has
 * nothing to do with the tools. One retry through `signIn` costs a few seconds
 * and removes that whole class of confusing failure.
 */
export async function visit(page: Page, path: string, retrying = false): Promise<void> {
    try {
        await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle2" });
    } catch (error) {
        if (!retrying) {
            await signIn(page);
            return visit(page, path, true);
        }
        throw new Error(
            `Could not open ${BASE_URL}${path}. Start the dev server with \`pnpm dev\`, `
            + `or point this suite elsewhere with WEBMCP_BASE_URL. `
            + `(${error instanceof Error ? error.message : String(error)})`,
        );
    }

    if (isAuthPath(page.url()) && !retrying) {
        await signIn(page);
        return visit(page, path, true);
    }

    if (!(await waitForTools(page))) {
        if (!retrying) {
            await signIn(page);
            return visit(page, path, true);
        }
        throw new Error(
            `No WebMCP tools registered on ${path} (settled at ${page.url()}). `
            + "Is the signed-in user able to see this page?",
        );
    }
}

/** Waits for one named tool to register, and says so plainly if it never does. */
async function waitForTool(page: Page, name: string): Promise<void> {
    const deadline = Date.now() + REGISTRATION_TIMEOUT_MS;
    let present: string[] = [];

    while (Date.now() < deadline) {
        try {
            present = await toolNames(page);
            if (present.includes(name)) return;
        } catch {
            // Context destroyed mid-evaluate: the page moved under us. Retry.
        }
        await sleep(250);
    }

    throw new Error(
        `${name} never registered on ${page.url()}. Registered: ${present.sort().join(", ")}`,
    );
}

/**
 * Polls from Node, tolerating the execution context being torn down by a
 * navigation that is still in flight when we start looking.
 */
async function waitForTools(page: Page): Promise<boolean> {
    const deadline = Date.now() + REGISTRATION_TIMEOUT_MS;

    while (Date.now() < deadline) {
        try {
            const count = await page.evaluate(
                async () => ((await document.modelContext?.getTools()) ?? []).length,
            );
            if (count > 0) return true;
        } catch {
            // Context destroyed mid-evaluate: the page moved under us. Retry.
        }
        await sleep(250);
    }

    return false;
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
    // Wait for the tool before calling it. `visit` returns as soon as *some*
    // tool exists, and the globals are there the moment the shell renders — so
    // without this, a call to a screen tool races that screen's registration
    // and fails as "not registered here" perhaps one run in five. A real agent
    // has the same problem and solves it the same way: re-read the tool list
    // after navigating.
    await waitForTool(page, name);

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

/**
 * Waits for a surface's tools, then asserts them.
 *
 * Polling rather than reading once, because registration is asynchronous: the
 * screen registers on mount, and a bare read races hydration. The globals are
 * present the moment the shell renders, so "some tool exists" proves nothing
 * about whether the screen under it has mounted yet — waiting for the specific
 * names is the only check that means anything.
 */
export async function expectTools(page: Page, expected: readonly string[]): Promise<void> {
    const deadline = Date.now() + REGISTRATION_TIMEOUT_MS;
    let present: string[] = [];

    while (Date.now() < deadline) {
        try {
            present = await toolNames(page);
            if (expected.every((name) => present.includes(name))) return;
        } catch {
            // Context destroyed by a navigation still in flight. Retry.
        }
        await sleep(250);
    }

    const missing = expected.filter((name) => !present.includes(name));
    assert.fail(
        `${missing.join(", ")} should be registered here but never appeared. `
        + `Registered: ${present.sort().join(", ")}`,
    );
}

/**
 * Asserts tools are *not* here.
 *
 * Only meaningful once the surface has finished registering — a tool that has
 * not mounted yet reads exactly like a tool that is correctly absent, so call
 * `expectTools` for something this surface does have first. Every caller here
 * does.
 */
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
