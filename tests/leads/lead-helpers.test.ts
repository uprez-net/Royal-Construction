import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LEAD_STAGE_OPTIONS,
  closureReasonCopy,
  parseLikelihood,
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

test("the stage select offers exactly one terminal-won label", () => {
  // Converted and Won were indistinguishable in every calculation; offering
  // both is what this change removes.
  assert.ok(LEAD_STAGE_OPTIONS.includes("Won"));
  assert.ok(!LEAD_STAGE_OPTIONS.includes("Converted" as never));
  assert.ok(LEAD_STAGE_OPTIONS.includes("Cancelled"));
});

/* ── forecast copy ─────────────────────────────────────────────────── */

test("banked copy no longer promises deals in negotiation", async () => {
  const { readFileSync } = await import("node:fs");
  const panel = readFileSync("components/leads/forecast-panel.tsx", "utf8");
  assert.ok(
    !/Won plus deals in negotiation/.test(panel),
    "forecast panel still claims negotiating deals are banked",
  );
  const kpi = readFileSync("components/leads/leads.tsx", "utf8");
  assert.ok(
    !/Won and converted leads/.test(kpi),
    "KPI card still refers to the retired Converted stage",
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

test("CreateTradieInput matches the Tradie columns", async () => {
  const { readFileSync } = await import("node:fs");
  const types = readFileSync("types/tradie.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  // createTradie does `prisma.tradie.create({ data: input })` — passing a
  // variable, so TypeScript performs no excess-property check and a field the
  // column list lacks fails only at runtime, with a green build.
  const block = types.slice(types.indexOf("interface CreateTradieInput"));
  const body = block.slice(0, block.indexOf("}"));
  for (const m of body.matchAll(/^\s*(\w+)\??:/gm)) {
    assert.ok(
      schema.includes(`  ${m[1]} `) || schema.includes(`  ${m[1]}  `),
      `CreateTradieInput.${m[1]} has no matching column on the Tradie model`,
    );
  }
});
