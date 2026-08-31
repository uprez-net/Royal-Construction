import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Browser, Page } from "puppeteer";

import {
    GLOBAL_TOOLS,
    LEADS_LIST_TOOLS,
    LEAD_DETAIL_TOOLS,
    LEAD_TAB_TOOLS,
    PROJECTS_LIST_TOOLS,
    PROJECT_DETAIL_TOOLS,
    PROJECT_TAB_TOOLS,
} from "../../lib/tools/surfaces";
import {
    RETIRED_TOOLS,
    expectTools,
    expectToolsAbsent,
    firstLeadId,
    firstProjectId,
    launchBrowser,
    openPage,
    signIn,
    readTool,
    toolNames,
    visit,
} from "./harness";

/**
 * The negative half, which is the half that matters.
 *
 * A tool appearing where it should is easy to notice by hand. A tool leaking
 * across surfaces, or a retired one quietly reappearing, is not — and both
 * defeat the point of scoping tools to screens in the first place.
 */
describe("surface scoping", () => {
    let browser: Browser;
    let page: Page;

    before(async () => {
        browser = await launchBrowser();
        page = await openPage(browser);
        await signIn(page);
    });

    after(async () => {
        await browser?.close();
    });

    const SURFACES = ["/dashboard", "/leads", "/projects", "/tradie"];

    test("the global tools are on every authenticated page", async () => {
        for (const path of SURFACES) {
            await visit(page, path);
            await expectTools(page, GLOBAL_TOOLS);
        }
    });

    test("no retired tool survives anywhere", async () => {
        for (const path of SURFACES) {
            await visit(page, path);
            await expectToolsAbsent(page, RETIRED_TOOLS);
        }
    });

    test("the dashboard is read-only, bar the one tool that admits it is not", async () => {
        // Nothing on the dashboard owns a record, so nothing there should be
        // able to change one.
        await visit(page, "/dashboard");
        const tools = await page.evaluate(
            async () => (await document.modelContext?.getTools()) ?? [],
        );

        for (const tool of tools) {
            const readOnly = (tool.annotations as { readOnlyHint?: boolean } | undefined)
                ?.readOnlyHint;

            if (tool.name === "navigate_to_offer") {
                // The exception, and it is declared rather than overlooked:
                // opening a lead's offer workspace PROVISIONS the Offer row if
                // the lead has none (ADR 0002), so this navigation really can
                // write. Labelling it read-only to keep this loop tidy would be
                // exactly the mislabelling the annotation exists to prevent.
                assert.equal(
                    readOnly,
                    false,
                    "navigate_to_offer can create an Offer row, so it must not claim to be read-only",
                );
                continue;
            }

            // Every other navigation tool declares readOnlyHint: true — it
            // changes the view, not the data — so every tool left should.
            assert.ok(readOnly, `${tool.name} is registered on the dashboard but is not read-only`);
        }
    });

    test("record tools do not leak onto the lists that link to them", async () => {
        await visit(page, "/projects");
        await expectTools(page, PROJECTS_LIST_TOOLS);
        await expectToolsAbsent(page, [
            ...PROJECT_DETAIL_TOOLS,
            ...Object.values(PROJECT_TAB_TOOLS).flat(),
        ]);

        await visit(page, "/leads");
        await expectTools(page, LEADS_LIST_TOOLS);
        await expectToolsAbsent(page, [
            ...LEAD_DETAIL_TOOLS,
            ...Object.values(LEAD_TAB_TOOLS).flat(),
        ]);
    });

    test("leaving a record takes its tools with it", async () => {
        await visit(page, "/projects");
        const projectId = await firstProjectId(page);

        await visit(page, `/projects/${projectId}`);
        await expectTools(page, PROJECT_DETAIL_TOOLS);

        await visit(page, "/dashboard");
        await expectToolsAbsent(page, PROJECT_DETAIL_TOOLS);
    });

    test("a project's tools are absent on a lead, and the reverse", async () => {
        await visit(page, "/projects");
        const projectId = await firstProjectId(page);
        await visit(page, "/leads");
        const leadId = await firstLeadId(page);

        await visit(page, `/leads/${leadId}`);
        await expectTools(page, LEAD_DETAIL_TOOLS);
        await expectToolsAbsent(page, PROJECT_DETAIL_TOOLS);

        await visit(page, `/projects/${projectId}`);
        await expectTools(page, PROJECT_DETAIL_TOOLS);
        await expectToolsAbsent(page, LEAD_DETAIL_TOOLS);
    });

    test("navigate_to_project reports the tools its destination actually has", async () => {
        // toolsNowAvailable is the answer to "what will navigating get me". If
        // it says something the page does not then deliver, the agent is worse
        // off than if it had said nothing.
        await visit(page, "/dashboard");
        const projectId = await firstProjectId(page);

        const payload = await readTool(page, "navigate_to_project", {
            projectId,
            tab: "milestones",
        });

        const promised = payload.toolsNowAvailable as string[];
        await page.waitForFunction(
            async (names: string[]) => {
                const tools = (await document.modelContext?.getTools()) ?? [];
                const present = tools.map((tool) => tool.name);
                return names.every((name) => present.includes(name));
            },
            { timeout: 20_000 },
            promised,
        );

        const present = await toolNames(page);
        for (const name of promised) {
            assert.ok(present.includes(name), `navigate_to_project promised ${name}, which is absent`);
        }
    });
});
