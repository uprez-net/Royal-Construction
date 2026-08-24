import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEAD_STAGE_GROUPS,
  LEAD_STAGE_OPTIONS,
  closureReasonCopy,
  isKpiCohortMetric,
  isLostStage,
  isQuotingStage,
  isTerminalStage,
  isWonStage,
  parseLikelihood,
  stageGroupsFor,
  stageOptionsFor,
} from "../../lib/leads/lead-helpers";

test("blank likelihood means no override", () => {
  assert.equal(parseLikelihood(""), null);
  assert.equal(parseLikelihood("   "), null);
});

test("unparseable likelihood means no override, not zero", () => {
  // The regression: `Number(raw) || 0` turned a typo into a real 0% forecast,
  // silently removing the deal's weighted contribution.
  for (const raw of ["abc", "1e", "--5", "12px", "NaN"]) {
    assert.equal(parseLikelihood(raw), null, `"${raw}" must not become 0`);
  }
});

test("valid likelihood is rounded and clamped to 0-100", () => {
  assert.equal(parseLikelihood("70"), 70);
  assert.equal(parseLikelihood("79.6"), 80);
  assert.equal(parseLikelihood("150"), 100);
  assert.equal(parseLikelihood("-20"), 0);
  assert.equal(parseLikelihood("0"), 0);
});

test("an explicit zero is preserved as a real override", () => {
  assert.equal(parseLikelihood("0"), 0);
  assert.notEqual(parseLikelihood("0"), null);
});

/* ── closureReasonCopy ─────────────────────────────────────────────── */

test("cancelled leads ask for a cancellation reason, not a lost reason", () => {
  const c = closureReasonCopy("Cancelled");
  assert.equal(c.label, "Cancellation reason");
  assert.equal(c.noun, "cancellation reason");
  assert.match(c.placeholder, /postponed|finance/i);
});

test("every other closed-unsuccessful stage keeps the lost wording", () => {
  for (const stage of ["Lost", "Disqualified"] as const) {
    assert.equal(closureReasonCopy(stage).label, "Lost reason", stage);
  }
});

test("the stage select offers Converted, not Won", () => {
  // "Converted" is the word Royal Constructions uses for a won deal. Renaming
  // it in the picker would mean re-teaching the team for no behaviour change,
  // so Won and Cancelled stay hidden and Converted stays the label.
  assert.ok(LEAD_STAGE_OPTIONS.includes("Converted"));
  assert.ok(!LEAD_STAGE_OPTIONS.includes("Won"));
  assert.ok(!LEAD_STAGE_OPTIONS.includes("Cancelled"));
});

test("a Converted lead counts as terminal and as won", () => {
  // The defect this branch fixes: isTerminalStage omitted Converted, so the
  // one label operators can pick left a won deal showing a Call button and no
  // Archive button — the row actions treated it as still open.
  assert.ok(isWonStage("Converted"));
  assert.ok(isTerminalStage("Converted"));
  assert.ok(isTerminalStage("Won"));
  assert.ok(!isTerminalStage("Negotiating"));
});

/* ── forecast copy ─────────────────────────────────────────────────── */

test("banked copy no longer promises deals in negotiation", async () => {
  // Negotiating is no longer banked, so the caption must not claim it is.
  // Only the wording changed here — the KPI card keeps saying "Converted",
  // which is still the vocabulary in the picker.
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("components/leads/forecast-panel.tsx", "utf8");
  assert.ok(
    !/Won plus deals in negotiation/.test(panel),
    "forecast panel still claims negotiating deals are banked",
  );
});

test("the live lead detail UI uses the shared likelihood parser", async () => {
  const { readFileSync } = await import("node:fs");
  const tab = readFileSync("components/leads/detail/lead-overview-tab.tsx", "utf8");
  // `Number(x) || 0` turns a typo into a real 0% forecast. It was fixed once in
  // the old detail modal and reappeared when that modal was replaced by this
  // full-page tab, so pin it here rather than relying on review.
  assert.ok(
    !/Number\(\s*(form\.)?probabilityOverride\s*\)\s*\|\|\s*0/.test(tab),
    "lead-overview-tab reintroduced the `Number(...) || 0` likelihood bug",
  );
  assert.ok(tab.includes("parseLikelihood"), "lead-overview-tab should use parseLikelihood");
  assert.ok(tab.includes("closureReasonCopy"), "lead-overview-tab should use stage-aware closure wording");
});

/* ── the reason rule holds on every path ───────────────────────────── */

test("the offer path cannot put a lead in a closed stage without a reason", async () => {
  const { readFileSync } = await import("node:fs");
  const offers = readFileSync("lib/data/offers.ts", "utf8");
  // updateOfferStatus writes lead.stage through a nested Prisma update, so it
  // never reaches updateLead's guard. Mapping REJECTED to LOST there produced
  // LOST rows with a null lostReason. Every declined/rejected offer status must
  // therefore stay OPEN; closing a lead is a human action.
  const map = offers.slice(
    offers.indexOf("OFFER_TO_LEAD_STATUS_UPDATE_MAP"),
    offers.indexOf("OFFER_STATE_MACHINE"),
  );
  assert.ok(!/REJECTED:\s*"LOST"/.test(map), "REJECTED must not map straight to LOST");
  assert.ok(!/:\s*"LOST"/.test(map), "no offer status may map a lead to LOST without a reason");
});

test("lead-write MCP tools report failures as errors", async () => {
  const { readFileSync } = await import("node:fs");
  const mcp = readFileSync("app/(mcp)/api/mcp/route.ts", "utf8");
  // These tools declare an outputSchema, so a catch that returns neither
  // isError nor structuredContent fails SDK output validation and the real
  // message never reaches the agent.
  for (const verb of ["updating lead", "creating lead", "fetching leads"]) {
    const at = mcp.indexOf(`Error ${verb}`);
    assert.ok(at > -1, `no catch found for "${verb}"`);
    const before = mcp.slice(Math.max(0, at - 400), at);
    assert.ok(before.includes("isError: true"), `"${verb}" catch is missing isError: true`);
  }
});

/* ── stageOptionsFor ───────────────────────────────────────────────── */

test("a lead on a hidden stage still gets an option to render", () => {
  // Won and Cancelled are hidden from the picker but the header badge can
  // still set them. Without an item to match, Radix renders the trigger blank
  // — its placeholder only covers "" and undefined.
  for (const hidden of ["Won", "Cancelled"] as const) {
    assert.ok(!LEAD_STAGE_OPTIONS.includes(hidden), `${hidden} should be hidden`);
    assert.ok(stageOptionsFor(hidden).includes(hidden), `${hidden} must render`);
  }
});

test("a lead on a visible stage does not widen the list", () => {
  // Appending unconditionally would duplicate the option and, in Radix, give
  // two items the same value.
  assert.deepEqual(stageOptionsFor("Converted"), LEAD_STAGE_OPTIONS);
  assert.equal(stageOptionsFor("New").length, LEAD_STAGE_OPTIONS.length);
});

test("both stage pickers offer the same list", async () => {
  // They used to disagree: the header badge built its own list from
  // STAGE_STYLES (a total Record, so all thirteen) while the Overview tab used
  // LEAD_STAGE_OPTIONS. Won and Cancelled were settable from one and invisible
  // in the other.
  const { readFileSync } = await import("node:fs");
  const badge = readFileSync("components/leads/detail/select-stage-badge.tsx", "utf8");
  assert.ok(
    !/Object\.keys\(STAGE_STYLES\)/.test(badge),
    "badge picker is building its own stage list again",
  );
  assert.ok(/stageOptionsFor\(/.test(badge), "badge picker should share stageOptionsFor");
});

/* ── isQuotingStage ────────────────────────────────────────────────── */

test("a won deal keeps its offer link under either label", () => {
  // The list named "Won" and missed "Converted". Converted is the label the
  // picker offers, so no won lead ever showed Check Offer in practice.
  assert.ok(isQuotingStage("Converted"));
  assert.ok(isQuotingStage("Won"));
});

test("quoting stages still cover the open ladder, and nothing closed-lost", () => {
  for (const open of ["In Follow-up", "Meeting Scheduled", "Qualified", "Quoted", "Negotiating"] as const) {
    assert.ok(isQuotingStage(open), open);
  }
  for (const lost of ["Lost", "Cancelled", "Disqualified"] as const) {
    assert.ok(!isQuotingStage(lost), lost);
  }
  assert.ok(!isQuotingStage("New"));
});

/* ── isKpiCohortMetric ─────────────────────────────────────────────── */

test("a KPI cohort is recognised, a chip list is not", () => {
  // The cohorts span stages with no chip: "converted" is Won + Converted.
  // Clicking the one visible chip used to leave the invisible half selected.
  for (const metric of ["total", "converted", "pendingFollowup", "lost"]) {
    assert.ok(isKpiCohortMetric(metric), metric);
  }
  // Chip lists are capitalised stage labels, so they must not match.
  assert.ok(!isKpiCohortMetric("Converted"));
  assert.ok(!isKpiCohortMetric("Lost,Disqualified"));
  assert.ok(!isKpiCohortMetric(null));
  assert.ok(!isKpiCohortMetric(""));
});

/* ── the grouped picker ────────────────────────────────────────────── */

test("the picker offers Discovery and no task stages", () => {
  assert.ok(LEAD_STAGE_OPTIONS.includes("Discovery"));
  for (const gone of ["In Follow-up", "Meeting Scheduled", "Won", "Cancelled"] as const) {
    assert.ok(!LEAD_STAGE_OPTIONS.includes(gone), `${gone} should not be selectable`);
  }
});

test("the closed group is not named after one of its members", () => {
  // Disqualified is a stage inside it, so reusing the word would leave people
  // guessing whether a filter meant the group or the stage.
  const closed = LEAD_STAGE_GROUPS.find((g) => g.stages.includes("Disqualified"));
  assert.equal(closed?.label, "Closed");
  assert.deepEqual(closed?.stages, ["No Response", "Disqualified", "Lost"]);
});

test("groups and the flat list never drift", () => {
  assert.deepEqual(LEAD_STAGE_GROUPS.flatMap((g) => g.stages), LEAD_STAGE_OPTIONS);
});

test("a lead on a retired stage still gets a rendered option", () => {
  // Rows hold these until the data migration has run everywhere, and Radix
  // renders the trigger blank when no item matches the value.
  for (const retired of ["In Follow-up", "Meeting Scheduled", "Won", "Cancelled"] as const) {
    assert.ok(stageOptionsFor(retired).includes(retired), retired);
    const groups = stageGroupsFor(retired);
    assert.ok(groups.flatMap((g) => g.stages).includes(retired), retired);
    assert.equal(groups.at(-1)?.label, "Retired", retired);
  }
});

test("a lead on a live stage does not get a Retired group", () => {
  for (const live of ["Discovery", "Qualified", "Converted", "Lost"] as const) {
    assert.deepEqual(stageGroupsFor(live), LEAD_STAGE_GROUPS, live);
  }
});

test("every live open stage can reach the offer", () => {
  // isQuotingStage gates "Check with Offer". It named the two retired stages
  // and never gained Discovery when they were replaced, which hid the button
  // from 33 of the 59 leads on staging: the whole stage where scoping happens.
  for (const s of ["Discovery", "Qualified", "Quoted", "Negotiating"] as const) {
    assert.ok(isQuotingStage(s), s);
  }
  // Too early to price, and closed-lost is not a quote.
  for (const s of ["New", "Contacted", "Lost", "Disqualified", "No Response"] as const) {
    assert.ok(!isQuotingStage(s), s);
  }
});

test("every stage the picker offers is classified by every predicate", () => {
  // The recurring defect in one assertion: a hand-written list forgets a stage
  // the ladder gained. Each option must be exactly one of open, won or lost.
  for (const stage of LEAD_STAGE_OPTIONS) {
    const buckets =
      Number(isWonStage(stage)) + Number(isLostStage(stage)) + Number(!isTerminalStage(stage));
    assert.equal(buckets, 1, `${stage} is in ${buckets} buckets`);
  }
});
