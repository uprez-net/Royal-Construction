import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Browser, Page } from "puppeteer";

import { OFFERS_LIST_TOOLS, OFFER_WORKSPACE_TOOLS } from "../../lib/tools/surfaces";
import {
    expectTools,
    expectToolsAbsent,
    launchBrowser,
    openPage,
    readTool,
    runTool,
    signIn,
    visit,
} from "./harness";

describe("offers list", () => {
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

    test("the list's tools are there, and the workspace's are not", async () => {
        await visit(page, "/offers");
        await expectTools(page, OFFERS_LIST_TOOLS);
        // The workspace tools register from new-offer-workspace.tsx, which is
        // not mounted here. Leaking them onto the list would offer the agent
        // writes with no offer to apply them to.
        await expectToolsAbsent(page, OFFER_WORKSPACE_TOOLS);
    });

    test("get_offers returns the page the user is looking at", async () => {
        await visit(page, "/offers");
        const payload = await readTool(page, "get_offers");

        assert.equal(typeof payload.page, "number");
        assert.equal(typeof payload.totalCount, "number");
        assert.equal(typeof payload.totalPages, "number");

        const items = payload.items as Record<string, unknown>[];
        assert.ok(Array.isArray(items));
        for (const item of items) {
            // leadId is the whole point of the row: it is what
            // navigate_to_offer takes. A row without one is unusable.
            assert.equal(typeof item.leadId, "number");
            assert.equal(typeof item.reference, "string");
            assert.equal(typeof item.versionCount, "number");
        }
    });

    test("get_offers says it is not status-filtered", async () => {
        // The tab strip above the table renders Pending/Approved/Rejected/Sent
        // and filters nothing. An agent that assumed otherwise would under-report,
        // so the payload has to be explicit rather than merely silent.
        await visit(page, "/offers");
        const payload = await readTool(page, "get_offers");

        assert.equal(payload.statusFilter, null);
        assert.match(String(payload.note), /do not filter/i);
    });

    test("search_offers narrows the list, and get_offers agrees afterwards", async () => {
        await visit(page, "/offers");
        const before = await readTool(page, "get_offers");
        const items = before.items as { client: string }[];

        if (items.length === 0) {
            // Nothing seeded to search for. Assert the empty search still works
            // rather than passing on an untested path.
            const empty = await readTool(page, "search_offers", { q: "" });
            assert.equal(typeof empty.totalCount, "number");
            return;
        }

        const term = String(items[0].client ?? "").slice(0, 4).trim();
        if (term.length < 2) return;

        const searched = await readTool(page, "search_offers", { q: term });
        assert.equal(searched.query, term);
        assert.equal(searched.page, 1, "a search must land on page 1, not the old page number");

        // The table now shows the search result, so the read tool must too —
        // the two describing different lists is the failure worth catching.
        const after = await readTool(page, "get_offers");
        assert.equal(after.totalCount, searched.totalCount);

        // Leave the list as it was found.
        await readTool(page, "search_offers", { q: "" });
    });

    test("search_offers refuses a call with no q rather than clearing silently", async () => {
        await visit(page, "/offers");
        const result = await runTool(page, "search_offers", {});

        assert.ok(result.isError, "a search with no q should be refused");
        assert.match(result.content?.[0]?.text ?? "", /q is required/);
    });
});
