import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Browser, Page } from "puppeteer";

import { OFFERS_LIST_TOOLS, OFFER_WORKSPACE_TOOLS } from "../../lib/tools/surfaces";
import {
    expectTools,
    expectToolsAbsent,
    firstOfferLeadId,
    launchBrowser,
    openPage,
    readTool,
    runTool,
    signIn,
    visit,
} from "./harness";

describe("offer workspace", () => {
    let browser: Browser;
    let page: Page;
    let leadId: number;

    before(async () => {
        browser = await launchBrowser();
        page = await openPage(browser);
        await signIn(page);
        await visit(page, "/leads");
        leadId = await firstOfferLeadId(page);
    });

    after(async () => {
        await browser?.close();
    });

    test("the workspace registers its whole surface from one component", async () => {
        // Not keyed by section, unlike the lead and project tabs: every section's
        // state lives in new-offer-workspace.tsx, so the registry is stable for
        // as long as the page is open. All 21 must be present at once.
        await visit(page, `/offers/${leadId}`);
        await expectTools(page, OFFER_WORKSPACE_TOOLS);
        await expectToolsAbsent(page, OFFERS_LIST_TOOLS);
    });

    test("navigate_to_offer sends the agent to the offer guide, not the global one", async () => {
        await visit(page, "/offers");
        const payload = await readTool(page, "navigate_to_offer", { leadId });

        assert.equal(payload.leadId, leadId);
        assert.match(String(payload.navigatedTo), new RegExp(`/offers/${leadId}$`));

        const available = payload.toolsNowAvailable as string[];
        for (const name of OFFER_WORKSPACE_TOOLS) {
            assert.ok(available.includes(name), `${name} missing from toolsNowAvailable`);
        }

        // The ten-section ladder is too large for the string sent on every
        // conversation, so the way to it has to travel with the navigation.
        const next = (payload.nextActions as string[]).join(" ");
        assert.match(next, /get_offer_workspace_state/);
        assert.match(next, /surface: "offers"/);
    });

    test("the offers guide is served, and is not the platform guide", async () => {
        await visit(page, `/offers/${leadId}`);
        const result = await runTool(page, "get_operating_guide", { surface: "offers" });
        const text = result.content?.[0]?.text ?? "";

        assert.match(text, /Offers — Surface Guide/);
        assert.match(text, /get_offer_workspace_state/);

        const platform = await runTool(page, "get_operating_guide", {});
        assert.match(platform.content?.[0]?.text ?? "", /Royal Construction — Operating Guide/);
        assert.notEqual(text, platform.content?.[0]?.text);
    });

    test("an unknown guide surface is refused rather than silently defaulted", async () => {
        await visit(page, `/offers/${leadId}`);
        const result = await runTool(page, "get_operating_guide", { surface: "tenders" });

        assert.ok(result.isError);
        assert.match(result.content?.[0]?.text ?? "", /only surface guide is "offers"/);
    });

    test("get_offer_workspace_state describes all ten sections", async () => {
        await visit(page, `/offers/${leadId}`);
        const payload = await readTool(page, "get_offer_workspace_state");

        assert.equal(typeof payload.status, "string");
        assert.equal(typeof payload.stateVersion, "number");

        const sections = payload.sections as Record<string, unknown>[];
        assert.equal(sections.length, 10, "the workspace has ten sections");
        for (const section of sections) {
            assert.equal(typeof section.section, "string");
            assert.equal(typeof section.unlocked, "boolean");
            assert.equal(typeof section.writable, "boolean");
        }
    });

    test("the later sections report having no tools, not being broken", async () => {
        await visit(page, `/offers/${leadId}`);
        const payload = await readTool(page, "get_offer_workspace_state");
        const sections = payload.sections as { section: string; reason?: string }[];

        for (const id of ["send", "tender-access", "tender", "contract", "project"]) {
            const section = sections.find((entry) => entry.section === id);
            assert.ok(section, `${id} missing`);
            assert.match(String(section.reason), /no tools/i);
        }
    });

    test("get_cost_schedule marks which rows can be priced directly", async () => {
        await visit(page, `/offers/${leadId}`);
        const payload = await readTool(page, "get_cost_schedule");

        const rows = payload.rows as Record<string, unknown>[];
        assert.ok(Array.isArray(rows));
        for (const row of rows) {
            assert.equal(typeof row.id, "string");
            assert.ok(["manual", "formula", "imported"].includes(String(row.source)));
            // A formula row's value comes from the measurements. Saying so is
            // what stops the agent writing a number that gets recomputed away.
            assert.equal(row.costEditable, row.source !== "formula");
        }
        assert.equal(typeof payload.requirements, "object");
    });

    test("get_pricing_summary keeps the inputs and the calculations apart", async () => {
        await visit(page, `/offers/${leadId}`);
        const payload = await readTool(page, "get_pricing_summary");

        const editable = payload.editable as Record<string, unknown>;
        const calculated = payload.calculated as Record<string, unknown>;

        assert.ok("royalConstructionFeePct" in editable);
        assert.ok("hbcfTotalContractValue" in editable);
        // The premium is reported beside the inputs but on the calculated side,
        // with its upstream named.
        assert.ok("homeWarrantyHbcfFixed" in calculated);
        assert.ok(!("homeWarrantyHbcfFixed" in editable));
        assert.match(
            String((payload.derivedFrom as Record<string, string>).homeWarrantyHbcfFixed),
            /hbcfTotalContractValue/,
        );
    });

    test("validate_offer_for_send answers, and never claims it can send", async () => {
        await visit(page, `/offers/${leadId}`);
        const payload = await readTool(page, "validate_offer_for_send");

        assert.equal(typeof payload.readyToSend, "boolean");
        assert.ok(Array.isArray(payload.blockers));
        assert.ok(Array.isArray(payload.warnings));
        assert.match(String(payload.note), /person/i);
    });

    test("open_offer_section expands a section on the real page", async () => {
        await visit(page, `/offers/${leadId}`);
        const payload = await readTool(page, "open_offer_section", { section: "scope" });

        assert.equal(payload.opened, true);
        assert.equal(payload.anchorId, "offer-step-scope");

        // The lifted open state has to reach the DOM, or the user is looking at
        // a collapsed header while the agent reports it opened the section.
        const bodyRendered = await page.evaluate(() => {
            const section = document.getElementById("offer-step-scope");
            // The header is always there; an expanded section has content after it.
            return (section?.children.length ?? 0) > 1;
        });
        assert.ok(bodyRendered, "open_offer_section did not expand the panel");
    });

    test("get_offer_section_data marks what is projected rather than typed", async () => {
        await visit(page, `/offers/${leadId}`);
        const payload = await readTool(page, "get_offer_section_data", { section: "job-setup" });

        assert.ok(payload.editable, "job setup should report its editable fields");
        const readOnly = payload.readOnly as Record<string, unknown>;
        // These are derived from the owners list. An agent that wrote one would
        // see it revert on the next owner edit.
        assert.ok("clientNames" in readOnly);
        assert.ok("currentLocation" in readOnly);
        assert.match(
            String((payload.derivedFrom as Record<string, string>).clientNames),
            /owners/i,
        );
    });
});
