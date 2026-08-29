import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Browser, Page } from "puppeteer";

import {
    PROJECT_DETAIL_TOOLS,
    PROJECT_TAB_TOOLS,
} from "../../lib/tools/surfaces";
import {
    expectTools,
    expectToolsAbsent,
    firstProjectId,
    launchBrowser,
    openPage,
    signIn,
    readTool,
    runTool,
    visit,
} from "./harness";

/**
 * The project surfaces, checked against what a real page registers.
 *
 * `lib/tools/surfaces.ts` is a promise made to the agent by every navigation
 * tool's `toolsNowAvailable`. These tests are what turns that promise into
 * something enforced rather than merely written down.
 */
describe("project detail", () => {
    let browser: Browser;
    let page: Page;
    let projectId: string;

    before(async () => {
        browser = await launchBrowser();
        page = await openPage(browser);
        await signIn(page);
        await visit(page, "/projects");
        projectId = await firstProjectId(page);
    });

    after(async () => {
        await browser?.close();
    });

    test("the header carries the project's own tools, on whatever tab", async () => {
        await visit(page, `/projects/${projectId}`);
        await expectTools(page, PROJECT_DETAIL_TOOLS);
    });

    test("get_project_warnings answers with both kinds of warning", async () => {
        await visit(page, `/projects/${projectId}`);
        const payload = await readTool(page, "get_project_warnings");

        assert.equal(payload.projectId, projectId);
        assert.ok(Array.isArray(payload.compliance), "compliance should be an array");
        assert.ok(Array.isArray(payload.tradies), "tradies should be an array");
        assert.equal(typeof payload.hasWarnings, "boolean");
    });

    test("the overview tab exposes its own read and write", async () => {
        await visit(page, `/projects/${projectId}?activeTab=overview`);
        await expectTools(page, PROJECT_TAB_TOOLS.overview);

        const payload = await readTool(page, "get_project_overview_details");
        assert.equal(payload.projectId, projectId);
        assert.ok(payload.sections, "the overview read should return its sections");
        assert.equal(typeof payload.hasUnsavedEdits, "boolean");
    });

    test("the milestone tab exposes the four verbs and the read", async () => {
        await visit(page, `/projects/${projectId}?activeTab=milestones`);
        await expectTools(page, PROJECT_TAB_TOOLS.milestones);

        const payload = await readTool(page, "get_milestones");
        assert.equal(payload.projectId, projectId);
        assert.ok(Array.isArray(payload.stages), "stages should be an array");

        // The two fields the whole four-verb design rests on: without them an
        // agent cannot tell which verb is legal and has to guess.
        for (const stage of payload.stages as { milestones: Record<string, unknown>[] }[]) {
            for (const milestone of stage.milestones) {
                assert.ok(Array.isArray(milestone.canBecome), "each milestone needs canBecome");
                assert.equal(typeof milestone.isActiveStage, "boolean");
            }
        }
    });

    test("an illegal milestone transition is refused with a reason, not attempted", async () => {
        await visit(page, `/projects/${projectId}?activeTab=milestones`);

        // A read-only probe of a write tool: a made-up id can never match a
        // milestone, so nothing is dispatched, but the refusal path still runs.
        const result = await runTool(page, "start_milestone", {
            milestoneId: "not-a-real-milestone",
            startDate: "2026-01-01",
        });

        assert.ok(result.isError, "starting a milestone that does not exist must fail");
        assert.match(
            result.content?.[0]?.text ?? "",
            /get_milestones/,
            "the refusal should tell the agent where to get real ids",
        );
    });

    test("add_milestone_photos opens the dialog and uploads nothing", async () => {
        await visit(page, `/projects/${projectId}?activeTab=milestones`);
        const payload = await readTool(page, "get_milestones");

        const first = (payload.stages as { milestones: { id: string }[] }[])
            .flatMap((stage) => stage.milestones)[0];
        if (!first) return; // A project with no milestones has nothing to open.

        const result = await runTool(page, "add_milestone_photos", { milestoneId: first.id });
        assert.ok(!result.isError, result.content?.[0]?.text);

        const modalType = await page.evaluate(
            () => document.querySelector("[role=dialog]") !== null,
        );
        assert.ok(modalType, "the photo dialog should be open");

        // The wording is the safety property. An agent that reads this as
        // success reports photos attached that nobody chose.
        assert.match(result.content?.[0]?.text ?? "", /user needs to choose/i);
    });

    test("the tradies tab exposes scheduling", async () => {
        await visit(page, `/projects/${projectId}?activeTab=tradies`);
        await expectTools(page, PROJECT_TAB_TOOLS.tradies);
    });

    test("the documents tab lists files as filename plus url", async () => {
        await visit(page, `/projects/${projectId}?activeTab=docs`);
        await expectTools(page, PROJECT_TAB_TOOLS.docs);

        const payload = await readTool(page, "get_project_files");
        assert.equal(payload.projectId, projectId);
        for (const file of payload.files as Record<string, unknown>[]) {
            assert.equal(typeof file.filename, "string");
            assert.equal(typeof file.url, "string");
        }
    });

    test("a tab's tools are gone when that tab is not open", async () => {
        // The whole model rests on this. If tab tools leaked across tabs, the
        // agent would be offered work the screen cannot show it doing.
        await visit(page, `/projects/${projectId}?activeTab=docs`);
        // Prove the tab actually mounted first. A tool that has not registered
        // yet is indistinguishable from one that is correctly absent, and this
        // assertion would pass for the wrong reason.
        await expectTools(page, PROJECT_TAB_TOOLS.docs);
        await expectToolsAbsent(page, [
            ...PROJECT_TAB_TOOLS.milestones,
            ...PROJECT_TAB_TOOLS.tradies,
            ...PROJECT_TAB_TOOLS.overview,
        ]);
    });
});
