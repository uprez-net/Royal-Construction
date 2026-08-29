import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Browser, Page } from "puppeteer";

import { LEAD_DETAIL_TOOLS, LEAD_TAB_TOOLS } from "../../lib/tools/surfaces";
import {
    expectTools,
    expectToolsAbsent,
    firstLeadId,
    launchBrowser,
    openPage,
    signIn,
    readTool,
    runTool,
    toolNames,
    visit,
} from "./harness";

describe("lead detail", () => {
    let browser: Browser;
    let page: Page;
    let leadId: number;

    before(async () => {
        browser = await launchBrowser();
        page = await openPage(browser);
        await signIn(page);
        await visit(page, "/leads");
        leadId = await firstLeadId(page);
    });

    after(async () => {
        await browser?.close();
    });

    test("the lead's own tools are there on whatever tab", async () => {
        await visit(page, `/leads/${leadId}`);
        await expectTools(page, LEAD_DETAIL_TOOLS);
    });

    test("get_lead_comms returns a thread with stable ids", async () => {
        await visit(page, `/leads/${leadId}`);
        const payload = await readTool(page, "get_lead_comms");

        assert.equal(payload.leadId, leadId);
        const messages = payload.messages as Record<string, unknown>[];
        assert.ok(Array.isArray(messages));

        for (const message of messages) {
            // send_lead_message takes one of these. An id that is not stable,
            // or absent, breaks replying entirely.
            assert.equal(typeof message.id, "string");
            assert.ok((message.id as string).length > 0);
            assert.equal(typeof message.subject, "string");
        }
    });

    test("get_lead_comms is marked as carrying untrusted content", async () => {
        // These bodies are customer-written email. The hint is advisory, but an
        // agent that never sees it has no signal at all.
        await visit(page, `/leads/${leadId}`);
        const tools = await page.evaluate(
            async () => (await document.modelContext?.getTools()) ?? [],
        );
        const comms = tools.find((tool) => tool.name === "get_lead_comms");

        assert.ok(comms, "get_lead_comms should be registered");
        assert.equal(
            (comms.annotations as { untrustedContentHint?: boolean } | undefined)
                ?.untrustedContentHint,
            true,
        );
    });

    test("send_lead_message is registered but is never called here", async () => {
        // Deliberately not executed. It opens a composer aimed at a real
        // customer, and a smoke test has no business anywhere near that.
        await visit(page, `/leads/${leadId}`);
        assert.ok((await toolNames(page)).includes("send_lead_message"));
    });

    test("the HBCF card answers, or says why it cannot", async () => {
        await visit(page, `/leads/${leadId}`);

        const result = await runTool(page, "get_lead_hbcf_timeline");
        if (result.isError) {
            // Loading and failing are both legitimate here; what matters is
            // that neither is reported as an empty claim book.
            assert.match(result.content?.[0]?.text ?? "", /loading|could not be loaded/i);
            return;
        }

        const payload = result.structuredContent as Record<string, unknown>;
        assert.equal(payload.leadId, leadId);
        assert.ok(payload.assessment, "an HBCF answer needs its assessment");
        assert.ok(Array.isArray(payload.claims));
    });

    test("the overview tab exposes editing", async () => {
        await visit(page, `/leads/${leadId}?activeTab=overview`);
        await expectTools(page, LEAD_TAB_TOOLS.overview);
    });

    test("edit_lead_details refuses an empty call rather than saving nothing", async () => {
        await visit(page, `/leads/${leadId}?activeTab=overview`);

        const result = await runTool(page, "edit_lead_details", {});
        assert.ok(result.isError, "an edit that names no field should be refused");
        assert.match(result.content?.[0]?.text ?? "", /Name at least one of/);
    });

    test("the documents tab lists files as filename plus url", async () => {
        await visit(page, `/leads/${leadId}?activeTab=documents`);
        await expectTools(page, LEAD_TAB_TOOLS.documents);

        const payload = await readTool(page, "get_lead_files");
        assert.equal(payload.leadId, leadId);
        for (const file of payload.files as Record<string, unknown>[]) {
            // `filename`, not the model's own `name`: the two file tools have
            // to describe a file the same way.
            assert.equal(typeof file.filename, "string");
            assert.equal(typeof file.url, "string");
        }
    });

    test("a tab's tools are gone when that tab is not open", async () => {
        await visit(page, `/leads/${leadId}?activeTab=documents`);
        // Prove the tab mounted before asserting the other tab's tools are
        // gone, or this passes for the wrong reason.
        await expectTools(page, LEAD_TAB_TOOLS.documents);
        await expectToolsAbsent(page, LEAD_TAB_TOOLS.overview);
    });
});
