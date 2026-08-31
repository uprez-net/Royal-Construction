import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Browser, Page } from "puppeteer";

import {
    firstOfferLeadId,
    launchBrowser,
    openPage,
    readTool,
    runTool,
    signIn,
    visit,
} from "./harness";

/**
 * Refusals only.
 *
 * The smoke suite performs no destructive writes, and that matters more here
 * than anywhere else in it: an offer write is picked up by the workspace
 * autosave and persisted against a real offer within about a second, so a test
 * that "just changes a headline" changes a real headline. Successful writes are
 * covered in tests/offer/webmcp-tools.test.ts, against fake mutators.
 *
 * Every call below is one the tool must reject before it reaches state.
 */
describe("offer workspace gating", () => {
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

    /** Asserts a refusal and that nothing about the offer moved. */
    async function expectRefusal(
        tool: string,
        args: Record<string, unknown>,
        pattern: RegExp,
    ): Promise<void> {
        const before = await readTool(page, "get_offer_workspace_state");
        const result = await runTool(page, tool, args);

        assert.ok(result.isError, `${tool} should have refused ${JSON.stringify(args)}`);
        assert.match(result.content?.[0]?.text ?? "", pattern);

        const after = await readTool(page, "get_offer_workspace_state");
        assert.equal(
            after.stateVersion,
            before.stateVersion,
            `${tool} was refused but the offer still changed`,
        );
    }

    test("a write naming no field is refused rather than saving nothing", async () => {
        // The edit_lead_details precedent: an empty patch that reports success
        // tells the agent the work is done when nothing happened.
        await visit(page, `/offers/${leadId}`);
        await expectRefusal("update_job_setup", {}, /Name at least one field/);
    });

    test("owner-projected fields are refused, with the reason", async () => {
        await visit(page, `/offers/${leadId}`);
        await expectRefusal(
            "update_job_setup",
            { clientNames: "Not The Owner" },
            /owners list/,
        );
    });

    test("a markup lever above 1 is refused as a percentage mistake", async () => {
        await visit(page, `/offers/${leadId}`);
        await expectRefusal(
            "update_pricing_inputs",
            { royalConstructionFeePct: 20 },
            /fraction/i,
        );
    });

    test("the calculated HBCF premium is refused, and its input named", async () => {
        await visit(page, `/offers/${leadId}`);
        await expectRefusal(
            "update_pricing_inputs",
            { homeWarrantyHbcfFixed: 9000 },
            /hbcfTotalContractValue/,
        );
    });

    test("the contractual schedule is not writable through the copy tool", async () => {
        await visit(page, `/offers/${leadId}`);
        await expectRefusal(
            "update_offer_document_content",
            { inclusionSchedule: [{ spec: "Everything" }] },
            /add_inclusion_item/,
        );
    });

    test("an invented cost-line id is refused with where to get a real one", async () => {
        await visit(page, `/offers/${leadId}`);
        await expectRefusal(
            "update_workbook_item",
            { id: "line-does-not-exist", costExGst: 1000 },
            /get_cost_schedule/,
        );
    });

    test("an invented scope id is refused", async () => {
        await visit(page, `/offers/${leadId}`);
        await expectRefusal(
            "update_scope_item",
            { type: "allowance", id: "nope", label: "x" },
            /get_offer_section_data/,
        );
    });

    test("an out-of-range inclusion index is refused with the real range", async () => {
        await visit(page, `/offers/${leadId}`);
        await expectRefusal(
            "remove_inclusion_item",
            { index: 9999 },
            /out of range/,
        );
    });

    test("an unknown section is refused with the list of real ones", async () => {
        await visit(page, `/offers/${leadId}`);
        const result = await runTool(page, "get_offer_section_data", { section: "nonsense" });

        assert.ok(result.isError);
        assert.match(result.content?.[0]?.text ?? "", /job-setup/);
    });

    test("a locked later phase refuses to open, and says what unlocks it", async () => {
        await visit(page, `/offers/${leadId}`);
        const state = await readTool(page, "get_offer_workspace_state");
        const sections = state.sections as { section: string; unlocked: boolean }[];
        const locked = sections.find((entry) => !entry.unlocked);

        if (!locked) {
            // This offer has run the whole ladder. Nothing to assert, and
            // forcing it into an earlier status would be a destructive write.
            return;
        }

        const result = await runTool(page, "open_offer_section", { section: locked.section });
        assert.ok(result.isError, `${locked.section} is locked but opened anyway`);
        assert.match(result.content?.[0]?.text ?? "", /unlocks once/i);
    });

    test("a frozen build section refuses writes but still opens for reading", async () => {
        await visit(page, `/offers/${leadId}`);
        const state = await readTool(page, "get_offer_workspace_state");
        const sections = state.sections as {
            section: string;
            writable: boolean;
            unlocked: boolean;
            lockedBecause?: string;
        }[];
        const frozen = sections.find(
            (entry) => entry.unlocked && !entry.writable && entry.lockedBecause,
        );

        if (!frozen) {
            // A pending offer has nothing frozen. Issuing one to create the
            // condition would send a real document, so this is left to the unit
            // tests, which cover all 17 statuses.
            return;
        }

        // The refusal has to name a way forward, not just say no.
        assert.match(frozen.lockedBecause ?? "", /revision|Pending|active revision/i);

        const opened = await readTool(page, "open_offer_section", { section: frozen.section });
        assert.equal(opened.opened, true, "a frozen section should still be viewable");
        assert.equal(opened.readOnly, true);
    });
});
