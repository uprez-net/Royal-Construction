import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOSE_DATE_TRACKING_START,
  PIPELINE_STAGES,
  WIN_RATE_WINDOW_DAYS,
  closeDatePatch,
  isOpenStage,
  stageDef,
} from "../../lib/leads/pipeline-stages";

const ALL_STAGES = [
  // Live ladder.
  "NEW",
  "CONTACTED",
  "DISCOVERY",
  "QUALIFIED",
  "QUOTED",
  "NEGOTIATING",
  "CONVERTED",
  "NO_RESPONSE",
  "DISQUALIFIED",
  "LOST",
  // Retired but still in the Prisma enum, so still keyed here. Rows hold them
  // until 20260821030100 has run against every database.
  "MEETING_SCHEDULED",
  "IN_FOLLOW_UP",
  "WON",
  "CANCELLED",
] as const;

test("every LeadStage has a definition", () => {
  for (const code of ALL_STAGES) {
    const def = stageDef(code);
    assert.ok(def, `missing definition for ${code}`);
    assert.equal(def.code, code);
    assert.ok(def.probability >= 0 && def.probability <= 100);
    assert.ok(def.label.length > 0);
  }
  assert.equal(Object.keys(PIPELINE_STAGES).length, ALL_STAGES.length);
});

test("orders are unique and contiguous from 1", () => {
  const orders = ALL_STAGES.map((c) => stageDef(c).order).sort((a, b) => a - b);
  assert.deepEqual(
    orders,
    Array.from({ length: ALL_STAGES.length }, (_, i) => i + 1),
  );
});

test("outcome classification matches the design", () => {
  assert.equal(stageDef("NEGOTIATING").outcome, "OPEN");
  assert.equal(stageDef("WON").outcome, "WON");
  assert.equal(stageDef("CONVERTED").outcome, "WON");
  assert.equal(stageDef("LOST").outcome, "LOST");
  assert.equal(stageDef("CANCELLED").outcome, "LOST");
  assert.equal(stageDef("DISQUALIFIED").outcome, "LOST");
  // NO_RESPONSE is stalled — neither open nor lost.
  assert.equal(stageDef("NO_RESPONSE").outcome, "STALLED");
});

test("banked stages are won outcomes only", () => {
  const banked = ALL_STAGES.filter((c) => stageDef(c).banked).sort();
  // NEGOTIATING was banked until the ladder change: sending an offer booked
  // 100% of the deal's face value before the customer agreed to anything.
  // CONVERTED is still here only because the Prisma enum keeps it until the
  // phase B migration; it drops out of this list with the enum.
  assert.deepEqual(banked, ["CONVERTED", "WON"]);
});

test("banked is equivalent to a won outcome", () => {
  // The invariant the Banked card now promises. If these ever diverge again,
  // the card is claiming money that has not been won.
  for (const code of ALL_STAGES) {
    const def = stageDef(code);
    assert.equal(
      def.banked,
      def.outcome === "WON",
      `${code} banked/outcome disagree`,
    );
  }
});

test("isOpenStage excludes stalled and closed stages", () => {
  assert.equal(isOpenStage("QUOTED"), true);
  assert.equal(isOpenStage("NO_RESPONSE"), false);
  assert.equal(isOpenStage("WON"), false);
  assert.equal(isOpenStage("LOST"), false);
});

const NOW = new Date("2026-08-16T02:00:00.000Z");

test("moving to a won stage stamps wonAt and clears lostAt", () => {
  assert.deepEqual(closeDatePatch("NEGOTIATING", "WON", NOW), {
    wonAt: NOW,
    lostAt: null,
  });
});

test("WON to CONVERTED does not re-stamp wonAt", () => {
  assert.deepEqual(closeDatePatch("WON", "CONVERTED", NOW), {});
});

test("moving to a lost stage stamps lostAt and clears wonAt", () => {
  assert.deepEqual(closeDatePatch("QUOTED", "LOST", NOW), {
    wonAt: null,
    lostAt: NOW,
  });
});

test("reopening a closed lead clears both stamps", () => {
  assert.deepEqual(closeDatePatch("WON", "NEGOTIATING", NOW), {
    wonAt: null,
    lostAt: null,
  });
});

test("moving to stalled clears both stamps", () => {
  assert.deepEqual(closeDatePatch("CONTACTED", "NO_RESPONSE", NOW), {
    wonAt: null,
    lostAt: null,
  });
});

test("an unchanged stage produces an empty patch", () => {
  assert.deepEqual(closeDatePatch("QUOTED", "QUOTED", NOW), {});
});

test("a brand new lead in an open stage produces an empty patch", () => {
  assert.deepEqual(closeDatePatch(null, "NEW", NOW), {});
});

test("a lead created directly in a won stage is stamped", () => {
  assert.deepEqual(closeDatePatch(null, "WON", NOW), {
    wonAt: NOW,
    lostAt: null,
  });
});

test("tracking constants are sane", () => {
  assert.equal(WIN_RATE_WINDOW_DAYS, 90);
  assert.ok(CLOSE_DATE_TRACKING_START instanceof Date);
  assert.ok(!Number.isNaN(CLOSE_DATE_TRACKING_START.getTime()));
});
