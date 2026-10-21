import assert from "node:assert/strict";

import { TradiePriceUnit } from "@prisma/client";
import { test } from "vitest";

import { DomainValidationError } from "@/lib/domain/errors";
import { createTradie, updateTradie } from "@/lib/domain/tradies/directory";
import {
  bookingTrade,
  tradieCoversTrade,
  tradieTrades,
} from "@/lib/domain/tradies/request-rules";
import {
  bookingsDisplacedBySelection,
  selectionRefusal,
} from "@/lib/domain/tradies/selection-rules";
import { settleTradeCancellation } from "@/lib/domain/tradies/trade-selection";
import { adminPrincipal, recordingDb } from "../architecture/domain-harness";

// A tradie can work in several trades: a plumber who is also a licensed
// gasfitter is offered for gas work too. That makes "which trade" a property
// of the booking rather than of the tradie, and every rule that used to read
// the tradie's one trade now has to ask which of theirs is meant.

const PLUMBER_GASFITTER = {
  trade: "Plumbing",
  trades: ["Plumbing", "Gas Fitting"],
};

test("a tradie covers every trade they list, and a row from before the list still covers its one trade", () => {
  assert.ok(tradieCoversTrade(PLUMBER_GASFITTER, "gas fitting"));
  assert.ok(tradieCoversTrade(PLUMBER_GASFITTER, "Plumbing"));
  assert.ok(!tradieCoversTrade(PLUMBER_GASFITTER, "Electrical"));
  assert.deepEqual(tradieTrades({ trade: "Tiling", trades: [] }), ["Tiling"]);
  assert.ok(tradieCoversTrade({ trade: "Tiling" }, "tiling"));
  assert.deepEqual(tradieTrades({ trade: " ", trades: [] }), []);
});

test("a booking is for its own trade, not its tradie's primary one", () => {
  assert.equal(
    bookingTrade({ trade: "Gas Fitting", tradie: { trade: "Plumbing" } }),
    "Gas Fitting",
  );
  // A row older than the column.
  assert.equal(
    bookingTrade({ trade: null, tradie: { trade: "Plumbing" } }),
    "Plumbing",
  );
});

test("selecting a tradie for one trade ignores their bookings in another", () => {
  const own = [
    // Priced and ready in Plumbing.
    {
      milestoneId: "m_rough",
      milestoneName: "Rough-in",
      quotedPrice: "900.00",
      status: "QUOTE_RECEIVED" as const,
      trade: "Plumbing",
      tradieName: "ABC",
    },
    // Still waiting on a quote, but for Gas Fitting.
    {
      milestoneId: "m_gas",
      milestoneName: "Gas line",
      quotedPrice: null,
      status: "AWAITING_QUOTE" as const,
      trade: "Gas Fitting",
      tradieName: "ABC",
    },
  ];
  assert.equal(
    selectionRefusal({
      liveSelection: null,
      others: [],
      own,
      trade: "Plumbing",
      tradieName: "ABC",
    }),
    null,
  );
  // And it displaces nobody on the gas activity.
  const rivalOnGas = {
    milestoneId: "m_gas",
    status: "AWAITING_QUOTE" as const,
    trade: "Gas Fitting",
  };
  assert.deepEqual(
    bookingsDisplacedBySelection(own, [rivalOnGas], "Plumbing"),
    [],
  );
});

test("cancelling a tradie for one trade leaves their bookings in another", async () => {
  const recorder = recordingDb({
    "tradeSelection.updateMany": { count: 1 },
    "tradieSchedule.findMany": [],
  });
  await settleTradeCancellation(
    {
      id: "ap_1",
      payload: { projectId: "p_1", selectionId: "sel_1", trade: "Plumbing" },
      tradieId: "t_abc",
    },
    true,
    recorder.db,
  );
  const read = recorder.calls.find(
    (call) => call.operation === "tradieSchedule.findMany",
  );
  const where = (read?.args as { where: Record<string, unknown> }).where;
  assert.deepEqual(where.OR, [
    { trade: { equals: "Plumbing", mode: "insensitive" } },
    {
      trade: null,
      tradie: { trade: { equals: "Plumbing", mode: "insensitive" } },
    },
  ]);
});

// ---------------------------------------------------------------------------
// The directory
// ---------------------------------------------------------------------------

/** The trade list has whatever is asked for, spelled as the list spells it. */
function tradeList(labels: readonly string[]) {
  return {
    "tradeType.findFirst": (args: unknown) => {
      const wanted = (
        args as { where: { label: { equals: string } } }
      ).where.label.equals.toLowerCase();
      const label = labels.find((item) => item.toLowerCase() === wanted);
      return label ? { archivedAt: null, id: label, label } : null;
    },
    "tradeType.findMany": labels.map((label) => ({ label })),
  };
}

const NEW_TRADIE = {
  abn: "1",
  email: "hello@example.com",
  lastQuotedPriceUnit: TradiePriceUnit.HOURLY,
  name: "ABC Plumbing & Gas",
  phone: "0400000000",
};

test("a new tradie is filed under every trade picked, the first as primary, each once", async () => {
  const recorder = recordingDb(tradeList(["Plumbing", "Gas Fitting"]));
  await createTradie(
    adminPrincipal(),
    { ...NEW_TRADIE, trades: ["plumbing", "Gas Fitting", "Plumbing"] },
    recorder.db,
  );
  const data = (recorder.writes()[0].args as { data: Record<string, unknown> })
    .data;
  assert.equal(data.trade, "Plumbing");
  assert.deepEqual(data.trades, ["Plumbing", "Gas Fitting"]);
});

test("a tradie with no trade at all is refused before anything is written", async () => {
  const recorder = recordingDb(tradeList(["Plumbing"]));
  await assert.rejects(
    createTradie(adminPrincipal(), { ...NEW_TRADIE, trades: [] }, recorder.db),
    (error: unknown) =>
      error instanceof DomainValidationError
      && /at least one trade/.test(error.message),
  );
  assert.deepEqual(recorder.writes(), []);
});

test("naming one trade on an edit makes it primary and keeps the others", async () => {
  const recorder = recordingDb({
    ...tradeList(["Plumbing", "Gas Fitting"]),
    "tradie.findUnique": {
      archivedAt: null,
      id: "t_abc",
      ...PLUMBER_GASFITTER,
    },
  });
  await updateTradie(
    adminPrincipal(),
    "t_abc",
    { trade: "Gas Fitting" },
    recorder.db,
  );
  const data = (recorder.writes()[0].args as { data: Record<string, unknown> })
    .data;
  assert.equal(data.trade, "Gas Fitting");
  assert.deepEqual(data.trades, ["Gas Fitting", "Plumbing"]);
});
