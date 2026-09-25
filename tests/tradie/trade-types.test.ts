import assert from "node:assert/strict";
import { TradiePriceUnit } from "@prisma/client";
import { test } from "vitest";

import {
  DomainAuthorizationError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { createTradie } from "@/lib/domain/tradies/directory";
import {
  createTradeType,
  deleteTradeType,
  resolveTradeLabel,
  setTradeTypeArchived,
  updateTradeType,
} from "@/lib/domain/tradies/trade-types";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";

// The trade list moved from a constant to the TradeType table so an admin can
// add a trade (Lighting) without a deploy. These are its rules: who may edit
// the list, what a name may be, which trades the Compliance tab depends on,
// and that a tradie can only be filed under a trade the list has.

const admin = adminPrincipal();

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "tt_1",
  label: "Electrician",
  icon: "zap",
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

test("only an admin may add a trade, and a refusal writes nothing", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    () =>
      createTradeType(
        customerPrincipal(),
        { label: "Lighting", icon: "lightbulb" },
        recorder.db,
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a new trade is stored tidied, with a known icon", async () => {
  const recorder = recordingDb({
    "tradeType.findFirst": null,
    "tradeType.create": (args: unknown) =>
      row({ ...(args as { data: object }).data }),
  });

  const created = await createTradeType(
    admin,
    { label: "  Lighting   Design ", icon: "lightbulb" },
    recorder.db,
  );

  assert.equal(created.label, "Lighting Design");
  assert.deepEqual(recorder.writes()[0].args, {
    data: { label: "Lighting Design", icon: "lightbulb" },
  });

  await assert.rejects(
    () =>
      createTradeType(admin, { label: "Lighting", icon: "Zap" }, recorder.db),
    (error: unknown) =>
      error instanceof DomainValidationError && error.field === "icon",
  );
  await assert.rejects(
    () => createTradeType(admin, { label: "   ", icon: "zap" }, recorder.db),
    DomainValidationError,
  );
});

test("a trade that already exists in any case is refused, and an archived one says restore", async () => {
  const live = recordingDb({
    "tradeType.findFirst": row({ label: "Lighting" }),
  });
  await assert.rejects(
    () => createTradeType(admin, { label: "lighting", icon: "lamp" }, live.db),
    /"Lighting" is already a trade/,
  );
  assert.deepEqual(live.writes(), []);
  const lookup = live.calls[0].args as { where: { label: object } };
  assert.deepEqual(lookup.where.label, {
    equals: "lighting",
    mode: "insensitive",
  });

  const archived = recordingDb({
    "tradeType.findFirst": row({ label: "Lighting", archivedAt: new Date() }),
  });
  await assert.rejects(
    () =>
      createTradeType(admin, { label: "Lighting", icon: "lamp" }, archived.db),
    /archived\. Restore it instead/,
  );
  assert.deepEqual(archived.writes(), []);
});

test("a rename moves every tradie under the old name in the same transaction", async () => {
  const recorder = recordingDb({
    "tradeType.findUnique": row(),
    "tradeType.findFirst": null,
    "tradeType.update": row({ label: "Electrical" }),
    "tradie.findMany": [{ id: "t_1" }, { id: "t_2" }],
  });

  const outcome = await updateTradeType(
    admin,
    { id: "tt_1", label: "Electrical" },
    recorder.transactionalDb,
  );

  assert.deepEqual(outcome.renamedTradieIds, ["t_1", "t_2"]);
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["tradeType.update", "tradie.updateMany"],
  );
  assert.deepEqual(recorder.writes()[1].args, {
    where: { id: { in: ["t_1", "t_2"] } },
    data: { trade: "Electrical" },
  });
  const holders = recorder.calls.find(
    (call) => call.operation === "tradie.findMany",
  );
  assert.deepEqual((holders?.args as { where: object }).where, {
    trade: "Electrician",
  });
});

test("a trade the Compliance tab picks by name keeps its name, but its icon can change", async () => {
  const locked = row({ label: "Surveying", icon: "compass" });

  const rename = recordingDb({ "tradeType.findUnique": locked });
  await assert.rejects(
    () =>
      updateTradeType(
        admin,
        { id: "tt_1", label: "Land Surveying" },
        rename.transactionalDb,
      ),
    /keeps its name/,
  );
  assert.deepEqual(rename.writes(), []);

  const icon = recordingDb({
    "tradeType.findUnique": locked,
    "tradeType.update": { ...locked, icon: "ruler" },
  });
  await updateTradeType(
    admin,
    { id: "tt_1", label: "Surveying", icon: "ruler" },
    icon.transactionalDb,
  );
  assert.deepEqual(icon.writes()[0].args, {
    where: { id: "tt_1" },
    data: { icon: "ruler" },
  });

  for (const label of ["Certifier", "surveying"]) {
    const archive = recordingDb({ "tradeType.findUnique": row({ label }) });
    await assert.rejects(
      () =>
        setTradeTypeArchived(admin, { id: "tt_1", archived: true }, archive.db),
      /cannot be archived/,
    );
    await assert.rejects(
      () => deleteTradeType(admin, { id: "tt_1" }, archive.db),
      /cannot be deleted/,
    );
    assert.deepEqual(archive.writes(), []);
  }
});

test("archiving twice is a no-op rather than a second write", async () => {
  const recorder = recordingDb({
    "tradeType.findUnique": row({ archivedAt: new Date() }),
  });
  await setTradeTypeArchived(
    admin,
    { id: "tt_1", archived: true },
    recorder.db,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("only a trade nobody holds can be deleted", async () => {
  const held = recordingDb({
    "tradeType.findUnique": row({ label: "Lighting" }),
    "tradie.count": 3,
  });
  await assert.rejects(
    () => deleteTradeType(admin, { id: "tt_1" }, held.db),
    /3 tradies are listed under "Lighting"\. Archive it instead/,
  );
  assert.deepEqual(held.writes(), []);

  const unused = recordingDb({
    "tradeType.findUnique": row({ label: "Lighting" }),
    "tradie.count": 0,
  });
  await deleteTradeType(admin, { id: "tt_1" }, unused.db);
  assert.deepEqual(unused.operations().at(-1), "tradeType.delete");
});

test("a tradie's trade is spelled the way the list spells it", async () => {
  const listed = recordingDb({
    "tradeType.findFirst": row({ label: "Plumbing" }),
  });
  assert.equal(await resolveTradeLabel(" plumbing ", listed.db), "Plumbing");

  const archived = recordingDb({
    "tradeType.findFirst": row({ label: "Plumbing", archivedAt: new Date() }),
  });
  await assert.rejects(
    () => resolveTradeLabel("Plumbing", archived.db),
    /archived\. Restore it/,
  );
  // Keeping the trade a tradie already has is not a change, even if archived.
  assert.equal(
    await resolveTradeLabel("Plumbing", archived.db, { current: "Plumbing" }),
    "Plumbing",
  );

  const unknown = recordingDb({
    "tradeType.findFirst": null,
    "tradeType.findMany": [{ label: "Electrician" }, { label: "Lighting" }],
  });
  await assert.rejects(
    () => resolveTradeLabel("Sparky", unknown.db),
    /"Sparky" is not a trade in the directory\. Use one of: Electrician, Lighting/,
  );
});

test("a tradie cannot be filed under a trade the list does not have", async () => {
  const recorder = recordingDb({
    "tradeType.findFirst": null,
    "tradeType.findMany": [{ label: "Electrician" }],
  });
  await assert.rejects(
    () =>
      createTradie(
        admin,
        {
          name: "Bright Sparks",
          trade: "Sparky",
          abn: "1",
          phone: "0400000000",
          email: "hello@example.com",
          lastQuotedPriceUnit: TradiePriceUnit.HOURLY,
        },
        recorder.db,
      ),
    DomainValidationError,
  );
  assert.deepEqual(recorder.writes(), []);
});
