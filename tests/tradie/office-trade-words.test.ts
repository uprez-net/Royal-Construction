import assert from "node:assert/strict";
import { test } from "vitest";

import { searchTradies } from "@/lib/domain/tradies/queries";
import { tradieInTradeWhere } from "@/lib/domain/tradies/request-rules";
import { tradeSearchTerms } from "@/lib/domain/tradies/trade-types";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// #429: "who's our best sparky?" found AR Electrical only because the office
// snapshot knew it. The directory search returned nothing for "sparky" or
// "electrician" — the office's words, which the handbook teaches the agent.

test("office words carry the fragment of the trade they mean", () => {
  assert.deepEqual(tradeSearchTerms("sparky"), ["sparky", "electric"]);
  assert.deepEqual(tradeSearchTerms("best chippy"), ["best chippy", "carpent"]);
  assert.deepEqual(tradeSearchTerms("Brickies"), ["Brickies", "brick"]);
  assert.deepEqual(tradeSearchTerms("electrician"), [
    "electrician",
    "electric",
  ]);
  assert.deepEqual(tradeSearchTerms("AR Electrical"), [
    "AR Electrical",
    "electric",
  ]);
  assert.deepEqual(tradeSearchTerms("Smith Homes"), ["Smith Homes"]);
  assert.deepEqual(tradeSearchTerms("  "), []);
});

test("a search for an office word reaches the trade it means", async () => {
  const recorder = recordingDb({
    "tradeType.findMany": [{ label: "Electrician" }],
    "tradie.findMany": [],
  });
  await searchTradies(
    adminPrincipal(),
    { favouriteOnly: false, limit: 10, query: "sparky" },
    recorder.db,
  );

  const labelLookup = recorder.calls.find(
    (call) => call.operation === "tradeType.findMany",
  )?.args as { where: { OR: unknown[] } };
  assert.ok(
    JSON.stringify(labelLookup.where.OR).includes('"contains":"electric"'),
  );

  const where = (
    recorder.calls.find((call) => call.operation === "tradie.findMany")
      ?.args as { where: { AND: Record<string, unknown>[] } }
  ).where;
  const clauses = JSON.stringify(where.AND[1].OR);
  assert.ok(clauses.includes('{"trades":{"hasSome":["Electrician"]}}'));
  assert.ok(clauses.includes('{"trade":{"contains":"electric"'));
});

test("a trade filter in office words becomes the listed trade", async () => {
  const recorder = recordingDb({
    "tradeType.findFirst": null,
    "tradeType.findMany": [
      { label: "Carpentry" },
      { label: "Fit-out Carpentry" },
    ],
    "tradie.findMany": [],
  });
  await searchTradies(
    adminPrincipal(),
    { favouriteOnly: false, limit: 10, query: "", trade: "chippy" },
    recorder.db,
  );
  const where = (
    recorder.calls.find((call) => call.operation === "tradie.findMany")
      ?.args as { where: { AND: Record<string, unknown>[] } }
  ).where;
  assert.deepEqual(where.AND[0], {
    OR: [
      tradieInTradeWhere("Carpentry"),
      tradieInTradeWhere("Fit-out Carpentry"),
    ],
  });
});
