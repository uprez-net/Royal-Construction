import assert from "node:assert/strict";
import { test } from "node:test";

import type { OfferToolDeps } from "../../components/offers/new-workflow/webmcp/deps";
import { createCostScheduleTools } from "../../components/offers/new-workflow/webmcp/cost-schedule-tools";
import { createDocumentTools } from "../../components/offers/new-workflow/webmcp/document-tools";
import { createJobSetupTools } from "../../components/offers/new-workflow/webmcp/job-setup-tools";
import { createOrientationTools } from "../../components/offers/new-workflow/webmcp/orientation-tools";
import { createPricingTools } from "../../components/offers/new-workflow/webmcp/pricing-tools";
import { createScopeTools } from "../../components/offers/new-workflow/webmcp/scope-tools";
import { OFFER_WORKSPACE_TOOLS } from "../../lib/tools/surfaces";
import { INITIAL_AREA_CALCULATOR } from "../../lib/offer/workspace-area";
import {
    DEFAULT_WORKSPACE_PRICING_SETTINGS,
    INITIAL_ALLOWANCES,
    INITIAL_COST_LINES,
    INITIAL_EXCLUSIONS,
    INITIAL_OFFER_DRAFT,
    INITIAL_OFFER_JOB,
} from "../../lib/offer/workspace-model";
import {
    calculateOfferCustomerPrice,
    calculateOfferWorkspacePricing,
} from "../../lib/offer/workspace-pricing";

/**
 * The offers write surface, exercised without a browser.
 *
 * This is where successful writes are covered. The Puppeteer suite deliberately
 * performs no destructive writes, and a workspace write is picked up by the
 * autosave and persisted against a real offer within about a second — so
 * asserting that a write lands belongs here, against fake mutators, and the
 * browser suite is left to cover registration, reads and refusals.
 */

type Call = { readonly fn: string; readonly args: readonly unknown[] };

function makeDeps(overrides: Partial<OfferToolDeps> = {}): {
    deps: OfferToolDeps;
    calls: Call[];
} {
    const calls: Call[] = [];
    const record =
        (fn: string) =>
        (...args: unknown[]) => {
            calls.push({ fn, args });
        };

    const pricing = calculateOfferWorkspacePricing({
        directTotal: 0,
        totalAreaSqm: 100,
        settings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
    });

    const deps: OfferToolDeps = {
        leadId: 42,
        status: "pending",
        reference: "RC-Q-2026-001",
        revision: "R1",
        stateVersion: 3,
        saveState: "saved",
        job: INITIAL_OFFER_JOB,
        lines: INITIAL_COST_LINES,
        allowances: INITIAL_ALLOWANCES,
        exclusions: INITIAL_EXCLUSIONS,
        draft: INITIAL_OFFER_DRAFT,
        areaCalculator: INITIAL_AREA_CALCULATOR,
        pricingSettings: DEFAULT_WORKSPACE_PRICING_SETTINGS,
        pricing,
        customerPrice: calculateOfferCustomerPrice({
            computedContractValueIncGst: pricing.contractValueIncGst,
            selectedContractValueIncGst: null,
            overrideReason: "",
        }),
        directTotal: 0,
        totalAreaSqm: 100,
        effectiveMargin: { effectiveMarkupPct: 0.2, marginStatus: "at_target" as never },
        selectedPriceInput: "",
        standardPriceInput: "",
        priceAdjustmentLabel: "",
        overrideReason: "",
        updateJob: record("updateJob"),
        updateLine: record("updateLine"),
        addLine: record("addLine"),
        removeLine: record("removeLine"),
        updateAreaCalculator: record("updateAreaCalculator"),
        updatePricingSettings: record("updatePricingSettings"),
        updateAllowance: record("updateAllowance"),
        updateExclusion: record("updateExclusion"),
        addAllowance: record("addAllowance"),
        addExclusion: record("addExclusion"),
        removeAllowance: record("removeAllowance"),
        removeExclusion: record("removeExclusion"),
        updateDraft: record("updateDraft"),
        setSelectedPriceInput: record("setSelectedPriceInput"),
        setStandardPriceInput: record("setStandardPriceInput"),
        setPriceAdjustmentLabel: record("setPriceAdjustmentLabel"),
        setOverrideReason: record("setOverrideReason"),
        setSectionOpen: record("setSectionOpen"),
        scrollToSection: record("scrollToSection"),
        prefillFromLead: async () => ({ ok: true, message: "Pre-filled siteAddress." }),
        ...overrides,
    };

    return { deps, calls };
}

function allTools(deps: OfferToolDeps) {
    return [
        ...createOrientationTools(deps),
        ...createJobSetupTools(deps),
        ...createCostScheduleTools(deps),
        ...createPricingTools(deps),
        ...createScopeTools(deps),
        ...createDocumentTools(deps),
    ];
}

const NO_OPTIONS = { signal: new AbortController().signal };

async function run(
    deps: OfferToolDeps,
    name: string,
    args: Record<string, unknown> = {},
): Promise<{ isError?: boolean; text: string; data: Record<string, unknown> }> {
    const tool = allTools(deps).find((entry) => entry.name === name);
    assert.ok(tool, `${name} is not registered`);
    const result = (await tool.execute(args, NO_OPTIONS)) as {
        isError?: boolean;
        content: { text: string }[];
        structuredContent?: Record<string, unknown>;
    };
    return {
        isError: result.isError,
        text: result.content[0]?.text ?? "",
        data: result.structuredContent ?? {},
    };
}

// ── Registration ─────────────────────────────────────────────────────────────

test("the factories register exactly what the surface map promises", () => {
    // lib/tools/surfaces.ts is what navigate_to_offer reports as
    // toolsNowAvailable and what the operating guide is checked against. A tool
    // named there and not built here is a capability the agent is told it has.
    const { deps } = makeDeps();
    const built = allTools(deps).map((tool) => tool.name).sort();
    assert.deepEqual(built, [...OFFER_WORKSPACE_TOOLS].sort());
});

test("every tool declares a schema, a description and its read/write nature", () => {
    const { deps } = makeDeps();
    for (const tool of allTools(deps)) {
        assert.ok(tool.description.length > 40, `${tool.name} has a thin description`);
        assert.equal(typeof tool.inputSchema, "object", `${tool.name} has no schema`);
        assert.equal(
            typeof tool.annotations?.readOnlyHint,
            "boolean",
            `${tool.name} does not declare readOnlyHint`,
        );
    }
});

test("readOnlyHint follows the verb, as it does in the shared manifest", () => {
    const { deps } = makeDeps();
    for (const tool of allTools(deps)) {
        const looksReadOnly = tool.name.startsWith("get_") || tool.name.startsWith("validate_");
        assert.equal(
            tool.annotations?.readOnlyHint,
            looksReadOnly,
            `${tool.name}: readOnlyHint is ${tool.annotations?.readOnlyHint} but the name says otherwise`,
        );
    }
});

// ── The gate ─────────────────────────────────────────────────────────────────

test("no write reaches state on a frozen section", () => {
    // The guarantee the whole gating module exists for, asserted over every
    // write tool rather than a sample of them.
    const { deps, calls } = makeDeps({ status: "agreed" });
    const writes = allTools(deps).filter((tool) => tool.annotations?.readOnlyHint === false);

    return Promise.all(
        writes
            .filter((tool) => tool.name !== "open_offer_section")
            .map(async (tool) => {
                const result = (await tool.execute({}, NO_OPTIONS)) as { isError?: boolean };
                assert.ok(result.isError, `${tool.name} did not refuse at status agreed`);
            }),
    ).then(() => {
        assert.equal(calls.length, 0, "a refused write still called a mutator");
    });
});

test("the negotiation window stays open for customer-facing sections", async () => {
    const { deps, calls } = makeDeps({ status: "sent" });

    const priced = await run(deps, "update_job_setup", { buildType: "Double storey" });
    assert.ok(priced.isError, "job setup should be frozen once the offer is issued");
    assert.match(priced.text, /still editable/i);

    const doc = await run(deps, "update_offer_document_content", { headline: "New headline" });
    assert.ok(!doc.isError, "the offer document should still accept edits at sent");
    assert.ok(calls.some((call) => call.fn === "updateDraft"));
});

// ── Job setup ────────────────────────────────────────────────────────────────

test("update_job_setup writes the patch it was given", async () => {
    const { deps, calls } = makeDeps();
    const result = await run(deps, "update_job_setup", {
        buildType: "Double storey",
        groundFloorSqm: 150,
    });

    assert.ok(!result.isError, result.text);
    const call = calls.find((entry) => entry.fn === "updateJob");
    assert.ok(call);
    assert.deepEqual(call.args[0], { buildType: "Double storey", groundFloorSqm: 150 });
    // A floor-area change moves the price, and the agent has no other signal.
    assert.match(String(result.data.recomputed), /price build-up/i);
});

test("update_job_setup refuses the fields projected from the owners list", async () => {
    // Writing one would stick until the next owner edit and then silently
    // revert, printing a name nobody entered in the meantime.
    const { deps, calls } = makeDeps();
    const result = await run(deps, "update_job_setup", { clientNames: "Someone Else" });

    assert.ok(result.isError);
    assert.match(result.text, /owners list/);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

test("update_job_setup reports every bad field, not just the first", async () => {
    const { deps, calls } = makeDeps();
    const result = await run(deps, "update_job_setup", {
        groundFloorSqm: -5,
        validUntil: "31/12/2026",
    });

    assert.ok(result.isError);
    assert.match(result.text, /groundFloorSqm/);
    assert.match(result.text, /validUntil/);
    assert.equal(calls.length, 0, "a patch with a bad field must not partially apply");
});

test("update_job_setup refuses a call that names nothing", async () => {
    const { deps } = makeDeps();
    const result = await run(deps, "update_job_setup", {});
    assert.ok(result.isError);
    assert.match(result.text, /Name at least one field/);
});

test("prefill refuses to overwrite filled fields until it is forced", async () => {
    const dirty = makeDeps({
        job: { ...INITIAL_OFFER_JOB, siteAddress: "1 Example St" },
    });
    const refused = await run(dirty.deps, "prefill_job_setup_from_lead", {});
    assert.ok(refused.isError);
    assert.match(refused.text, /siteAddress/);
    assert.match(refused.text, /force: true/);

    const forced = await run(dirty.deps, "prefill_job_setup_from_lead", { force: true });
    assert.ok(!forced.isError, forced.text);
    assert.equal(forced.data.prefilled, true);
});

// ── Cost schedule ────────────────────────────────────────────────────────────

test("a formula row refuses a direct cost, but still takes its labels", async () => {
    const formulaRow = {
        ...INITIAL_COST_LINES[0],
        id: "line-formula",
        formula: "groundFloorSqm * 12",
    };
    const { deps, calls } = makeDeps({ lines: [formulaRow] });

    const refused = await run(deps, "update_workbook_item", {
        id: "line-formula",
        costExGst: 1000,
    });
    assert.ok(refused.isError);
    assert.match(refused.text, /calculated/i);
    // Naming the upstream is what stops the agent concluding the row is
    // untouchable and giving up on the section.
    assert.match(refused.text, /update_cost_requirements/);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");

    const allowed = await run(deps, "update_workbook_item", {
        id: "line-formula",
        tradeOrVendor: "Acme Concrete",
    });
    assert.ok(!allowed.isError, allowed.text);
    assert.ok(calls.some((call) => call.fn === "updateLine"));
});

test("the offer/tender line item and the spec note stay in step", async () => {
    // The grid writes both from one textarea, so a tool that let them diverge
    // would create a state no click can produce or repair.
    const row = { ...INITIAL_COST_LINES[0], id: "line-1", formula: undefined };
    const { deps, calls } = makeDeps({ lines: [row] });

    await run(deps, "update_workbook_item", {
        id: "line-1",
        offerTenderLineItem: "Concrete slab to engineer's design",
    });

    const patch = calls.find((call) => call.fn === "updateLine")?.args[1] as Record<string, unknown>;
    assert.equal(patch.offerTenderLineItem, "Concrete slab to engineer's design");
    assert.equal(patch.notesOrSpec, "Concrete slab to engineer's design");
});

test("pricing a row includes it, as the grid does", async () => {
    const row = { ...INITIAL_COST_LINES[0], id: "line-1", formula: undefined };
    const { deps, calls } = makeDeps({ lines: [row] });

    await run(deps, "update_workbook_item", { id: "line-1", costExGst: 2500 });

    const patch = calls.find((call) => call.fn === "updateLine")?.args[1] as Record<string, unknown>;
    assert.equal(patch.costExGst, 2500);
    assert.equal(patch.includedInContract, true);
});

test("an unknown cost line is refused by id, with where to get the right one", async () => {
    const { deps, calls } = makeDeps({ lines: [] });
    const result = await run(deps, "update_workbook_item", { id: "nope", costExGst: 1 });

    assert.ok(result.isError);
    assert.match(result.text, /get_cost_schedule/);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

test("update_cost_requirements writes only the measurements it was given", async () => {
    const { deps, calls } = makeDeps();
    const result = await run(deps, "update_cost_requirements", { numberOfTrucks: 4 });

    assert.ok(!result.isError, result.text);
    const call = calls.find((entry) => entry.fn === "updateAreaCalculator");
    assert.deepEqual(call?.args[0], { numberOfTrucks: 4 });
});

// ── Pricing ──────────────────────────────────────────────────────────────────

test("a markup lever above 1 is refused as a percentage mistake", async () => {
    // 20 rather than 0.2 would quote a job at twenty times cost and still look
    // like a plausible number in the payload.
    const { deps, calls } = makeDeps();
    const result = await run(deps, "update_pricing_inputs", {
        royalConstructionFeePct: 20,
    });

    assert.ok(result.isError);
    assert.match(result.text, /fraction/i);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

test("the HBCF premium is refused, and the input to change is named", async () => {
    const { deps, calls } = makeDeps();
    const result = await run(deps, "update_pricing_inputs", { homeWarrantyHbcfFixed: 9000 });

    assert.ok(result.isError);
    assert.match(result.text, /hbcfTotalContractValue/);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

test("an unexplained price override is refused rather than left unsendable", async () => {
    const { deps, calls } = makeDeps();
    const computed = deps.customerPrice.computedContractValueIncGst;

    const refused = await run(deps, "set_customer_price", { selectedPrice: computed + 50_000 });
    assert.ok(refused.isError);
    assert.match(refused.text, /overrideReason/);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");

    const accepted = await run(deps, "set_customer_price", {
        selectedPrice: computed + 50_000,
        overrideReason: "Matched a competing quote.",
    });
    assert.ok(!accepted.isError, accepted.text);
    assert.ok(calls.some((call) => call.fn === "setSelectedPriceInput"));
    assert.ok(calls.some((call) => call.fn === "setOverrideReason"));
});

test("clearing the override needs no reason", async () => {
    const { deps, calls } = makeDeps();
    const result = await run(deps, "set_customer_price", { selectedPrice: 0 });

    assert.ok(!result.isError, result.text);
    assert.deepEqual(
        calls.find((call) => call.fn === "setSelectedPriceInput")?.args,
        [""],
    );
});

// ── Scope ────────────────────────────────────────────────────────────────────

test("an id in the other scope list is corrected, not just rejected", async () => {
    const { deps } = makeDeps();
    const exclusionId = INITIAL_EXCLUSIONS[0]?.id;
    assert.ok(exclusionId, "fixture needs at least one exclusion");

    const result = await run(deps, "update_scope_item", {
        type: "allowance",
        id: exclusionId,
        label: "Renamed",
    });

    assert.ok(result.isError);
    assert.match(result.text, /is an exclusion, not an allowance/);
});

test("removing an exclusion says what it did to the price's meaning", async () => {
    const { deps, calls } = makeDeps();
    const exclusionId = INITIAL_EXCLUSIONS[0]?.id;
    assert.ok(exclusionId);

    const result = await run(deps, "remove_scope_item", { type: "exclusion", id: exclusionId });
    assert.ok(!result.isError, result.text);
    assert.match(String(result.data.warning), /covering this work/i);
    assert.deepEqual(
        calls.find((call) => call.fn === "removeExclusion")?.args,
        [exclusionId],
    );
});

test("an unknown scope category is refused with the valid ones", async () => {
    const { deps, calls } = makeDeps();
    const result = await run(deps, "add_scope_item", {
        type: "allowance",
        label: "Tiling",
        category: "made_up",
    });

    assert.ok(result.isError);
    assert.match(result.text, /prime_cost/);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

// ── Offer document ───────────────────────────────────────────────────────────

test("the contractual schedule is not writable through the copy tool", async () => {
    // The two lists are separate on purpose: the selling line and the contract
    // row are one-to-many. Conflating them would put unreviewed copy in a
    // contract document.
    const { deps, calls } = makeDeps();
    const result = await run(deps, "update_offer_document_content", {
        inclusionSchedule: [{ spec: "Everything" }],
    });

    assert.ok(result.isError);
    assert.match(result.text, /add_inclusion_item/);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

test("an inclusion index outside the schedule is refused with the real range", async () => {
    const { deps, calls } = makeDeps();
    const length = INITIAL_OFFER_DRAFT.inclusionSchedule.length;

    const result = await run(deps, "update_inclusion_item", { index: length + 5, spec: "x" });
    assert.ok(result.isError);
    assert.match(result.text, new RegExp(String(length)));
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

test("editing an inclusion clears its unreviewed-AI marking", async () => {
    // The flag means "contract text a human did not write". Once a human has
    // asked for this wording, it no longer applies.
    const drafted = {
        ...INITIAL_OFFER_DRAFT,
        inclusionSchedule: [{ spec: "Model wrote this", draftedByAi: true }],
    };
    const { deps, calls } = makeDeps({ draft: drafted });

    const result = await run(deps, "update_inclusion_item", { index: 0, spec: "Reviewed wording" });
    assert.ok(!result.isError, result.text);

    const patch = calls.find((call) => call.fn === "updateDraft")?.args[0] as {
        inclusionSchedule: { spec: string; draftedByAi?: boolean }[];
    };
    assert.equal(patch.inclusionSchedule[0].spec, "Reviewed wording");
    assert.equal(patch.inclusionSchedule[0].draftedByAi, false);
});

test("removing an inclusion warns that later indexes shifted", async () => {
    const { deps, calls } = makeDeps();
    const before = INITIAL_OFFER_DRAFT.inclusionSchedule.length;
    assert.ok(before > 0, "fixture needs an inclusion schedule");

    const result = await run(deps, "remove_inclusion_item", { index: 0 });
    assert.ok(!result.isError, result.text);
    assert.equal(result.data.remaining, before - 1);
    assert.match(String(result.data.warning), /shifted down/i);

    const patch = calls.find((call) => call.fn === "updateDraft")?.args[0] as {
        inclusionSchedule: unknown[];
    };
    assert.equal(patch.inclusionSchedule.length, before - 1);
});

// ── Reads ────────────────────────────────────────────────────────────────────

test("the workspace state reports all ten sections, in order", async () => {
    const { deps } = makeDeps();
    const result = await run(deps, "get_offer_workspace_state");

    const sections = result.data.sections as { section: string; index: number }[];
    assert.equal(sections.length, 10);
    assert.deepEqual(
        sections.map((entry) => entry.index),
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    assert.equal(result.data.stateVersion, 3);
});

test("a frozen offer reports every build section as unwritable, with a reason", async () => {
    const { deps } = makeDeps({ status: "contract_sent" });
    const result = await run(deps, "get_offer_workspace_state");

    const sections = result.data.sections as {
        section: string;
        writable: boolean;
        lockedBecause?: string;
    }[];
    for (const section of sections.slice(0, 5)) {
        assert.equal(section.writable, false, `${section.section} should be frozen`);
        assert.ok(section.lockedBecause, `${section.section} gives no reason`);
    }
});

test("the later sections say they have no tools rather than looking broken", async () => {
    const { deps } = makeDeps();
    const result = await run(deps, "get_offer_workspace_state");
    const sections = result.data.sections as { section: string; reason?: string }[];

    for (const id of ["send", "tender-access", "tender", "contract", "project"]) {
        const section = sections.find((entry) => entry.section === id);
        assert.ok(section, `${id} missing from the state`);
        assert.match(String(section.reason), /no tools/i);
    }
});

test("locked later sections carry the same hint the panel shows the user", async () => {
    const { deps } = makeDeps({ status: "pending" });
    const result = await run(deps, "get_offer_workspace_state");
    const sections = result.data.sections as {
        section: string;
        unlocked: boolean;
        unlockCondition?: string;
    }[];

    const tender = sections.find((entry) => entry.section === "tender-access");
    assert.equal(tender?.unlocked, false);
    assert.match(String(tender?.unlockCondition), /once the Offer is agreed/i);
});

test("the cost schedule marks formula rows as not directly priceable", async () => {
    const rows = [
        { ...INITIAL_COST_LINES[0], id: "manual", formula: undefined, sourceReference: undefined },
        { ...INITIAL_COST_LINES[0], id: "derived", formula: "groundFloorSqm * 12" },
    ];
    const { deps } = makeDeps({ lines: rows });
    const result = await run(deps, "get_cost_schedule");

    const returned = result.data.rows as { id: string; source: string; costEditable: boolean }[];
    assert.equal(returned.find((row) => row.id === "manual")?.source, "manual");
    assert.equal(returned.find((row) => row.id === "manual")?.costEditable, true);
    assert.equal(returned.find((row) => row.id === "derived")?.source, "formula");
    assert.equal(returned.find((row) => row.id === "derived")?.costEditable, false);
});

test("the pricing read separates the four inputs from everything calculated", async () => {
    const { deps } = makeDeps();
    const result = await run(deps, "get_pricing_summary");

    assert.deepEqual(Object.keys(result.data.editable as object).sort(), [
        "hbcfTotalContractValue",
        "impactFeeFixed",
        "royalConstructionFeePct",
        "royalConstructionOverheadPct",
    ]);
    // The premium is reported, but on the calculated side, and with its inputs
    // named — that pairing is what stops the agent trying to write it.
    const calculated = result.data.calculated as Record<string, unknown>;
    assert.ok("homeWarrantyHbcfFixed" in calculated);
    const derivedFrom = result.data.derivedFrom as Record<string, string>;
    assert.match(derivedFrom.homeWarrantyHbcfFixed, /hbcfTotalContractValue/);
});

test("validate_offer_for_send separates what blocks from what only warns", async () => {
    const { deps } = makeDeps();
    const result = await run(deps, "validate_offer_for_send");

    assert.equal(typeof result.data.readyToSend, "boolean");
    assert.ok(Array.isArray(result.data.blockers));
    assert.ok(Array.isArray(result.data.warnings));
    // An empty offer has owner problems, and those are hard blockers.
    assert.ok((result.data.blockers as unknown[]).length > 0);
    assert.equal(result.data.readyToSend, false);
    // It must never read as though the agent could send it.
    assert.match(String(result.data.note), /person/i);
});

test("an unknown section name is refused with the list of real ones", async () => {
    const { deps } = makeDeps();
    const result = await run(deps, "get_offer_section_data", { section: "pricing-v2" });

    assert.ok(result.isError);
    assert.match(result.text, /job-setup/);
});

// ── Section opening ──────────────────────────────────────────────────────────

test("open_offer_section expands and scrolls to a build section", async () => {
    const { deps, calls } = makeDeps();
    const result = await run(deps, "open_offer_section", { section: "scope" });

    assert.ok(!result.isError, result.text);
    assert.deepEqual(
        calls.find((call) => call.fn === "setSectionOpen")?.args,
        ["offer-step-scope", true],
    );
    assert.deepEqual(
        calls.find((call) => call.fn === "scrollToSection")?.args,
        ["offer-step-scope"],
    );
});

test("a frozen section still opens, marked read-only", async () => {
    // Unlike a write, showing the user a frozen section is useful. Refusing
    // would leave the agent unable to point at what it is describing.
    const { deps, calls } = makeDeps({ status: "agreed" });
    const result = await run(deps, "open_offer_section", { section: "pricing" });

    assert.ok(!result.isError, result.text);
    assert.equal(result.data.readOnly, true);
    assert.ok(calls.some((call) => call.fn === "setSectionOpen"));
});

test("open_offer_section refuses a phase that has not unlocked", async () => {
    const { deps, calls } = makeDeps({ status: "pending" });
    const result = await run(deps, "open_offer_section", { section: "contract" });

    assert.ok(result.isError);
    assert.match(result.text, /Tender is signed/i);
    assert.equal(calls.length, 0, "a refused call still reached a mutator");
});

// ── Save reporting ───────────────────────────────────────────────────────────

test("a write says it is not yet saved, because it is not", async () => {
    // The autosave runs ~800ms later. A tool that reported "saved" here would
    // have the agent tell the user something that is not true yet.
    const { deps } = makeDeps({ saveState: "idle" });
    const result = await run(deps, "update_offer_document_content", { headline: "Hello" });

    assert.equal(result.data.saved, false);
    assert.equal(result.data.saveState, "idle");
    assert.match(String(result.data.note), /autosaves/i);
});
