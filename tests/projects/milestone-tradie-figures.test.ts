import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainStaleVersionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { setMilestoneTradieFigure } from "@/lib/domain/projects/milestone-tradie-figures";

import {
  adminPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// The Financials tab's inline edit of an activity's own Tradie quoted and
// Total invoiced figures. A typed figure replaces what the bookings say; null
// puts the bookings' figure back. Replays are answered, stale edits refused.

const PROJECT = {
  id: "project-1",
  location: "Penrith",
  name: "Smith build",
  siteManagerId: null,
};

const dollars = (value: number | null) =>
  value === null ? null : new Prisma.Decimal(value);

function db(
  stored: { quoted?: number | null; invoiced?: number | null } = {},
  extra: Record<string, unknown> = {},
) {
  return recordingDb({
    "milestone.findUnique": { projectId: PROJECT.id },
    "milestone.findUniqueOrThrow": {
      id: "trusses",
      name: "Roof trusses",
      tradieInvoicedOverride: dollars(stored.invoiced ?? null),
      tradieQuotedOverride: dollars(stored.quoted ?? null),
    },
    "milestone.updateMany": { count: 1 },
    "project.findUnique": PROJECT,
    ...extra,
  });
}

type Write = {
  data: {
    tradieQuotedOverride?: Prisma.Decimal | null;
    tradieInvoicedOverride?: Prisma.Decimal | null;
    message?: string;
  };
  where: {
    tradieQuotedOverride?: Prisma.Decimal | null;
    tradieInvoicedOverride?: Prisma.Decimal | null;
  };
};

describe("setMilestoneTradieFigure", () => {
  test("types the tradie quoted figure over the bookings', conditionally, and logs it", async () => {
    const recorder = db();
    const outcome = await setMilestoneTradieFigure(
      adminPrincipal(),
      {
        cents: 420_050,
        figure: "quoted",
        milestoneId: "trusses",
        previousCents: null,
      },
      recorder.db,
    );
    assert.deepEqual(outcome, {
      changed: true,
      milestoneId: "trusses",
      projectId: PROJECT.id,
    });
    const writes = recorder.writes();
    assert.deepEqual(
      writes.map((write) => write.operation),
      ["milestone.updateMany", "activityLog.create"],
    );
    const [own, log] = writes.map((write) => write.args as Write);
    assert.equal(own.data.tradieQuotedOverride?.toString(), "4200.5");
    assert.equal(own.data.tradieInvoicedOverride, undefined);
    // Conditional on the figure read, so a racing second save cannot apply.
    assert.equal(own.where.tradieQuotedOverride, null);
    assert.match(
      log.data.message ?? "",
      /Roof trusses tradie quoted changed from the bookings' figure to \$4,200\.50/,
    );
  });

  test("clearing the invoiced figure writes null and says so", async () => {
    const recorder = db({ invoiced: 900 });
    const outcome = await setMilestoneTradieFigure(
      adminPrincipal(),
      {
        cents: null,
        figure: "invoiced",
        milestoneId: "trusses",
        previousCents: 90_000,
      },
      recorder.db,
    );
    assert.equal(outcome.changed, true);
    const [own, log] = recorder.writes().map((write) => write.args as Write);
    assert.equal(own.data.tradieInvoicedOverride, null);
    assert.equal(own.where.tradieInvoicedOverride?.toString(), "900");
    assert.match(
      log.data.message ?? "",
      /total invoiced changed from \$900\.00 to the bookings' figure/,
    );
  });

  test("saving the figure it already holds is a replay, and writes nothing", async () => {
    const recorder = db({ quoted: 4_200 });
    const outcome = await setMilestoneTradieFigure(
      adminPrincipal(),
      {
        cents: 420_000,
        figure: "quoted",
        milestoneId: "trusses",
        previousCents: null,
      },
      recorder.db,
    );
    assert.equal(outcome.changed, false);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a figure that moved since the screen loaded is refused", async () => {
    const recorder = db({ quoted: 3_000 });
    await assert.rejects(
      setMilestoneTradieFigure(
        adminPrincipal(),
        {
          cents: 420_000,
          figure: "quoted",
          milestoneId: "trusses",
          previousCents: null,
        },
        recorder.db,
      ),
      DomainStaleVersionError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("losing a race to the same save is answered as a replay", async () => {
    let reads = 0;
    const recorder = db(
      {},
      {
        "milestone.findUniqueOrThrow": () =>
          ++reads === 1
            ? {
                id: "trusses",
                name: "Roof trusses",
                tradieInvoicedOverride: null,
                tradieQuotedOverride: null,
              }
            : {
                tradieInvoicedOverride: null,
                tradieQuotedOverride: dollars(4_200),
              },
        "milestone.updateMany": { count: 0 },
      },
    );
    const outcome = await setMilestoneTradieFigure(
      adminPrincipal(),
      {
        cents: 420_000,
        figure: "quoted",
        milestoneId: "trusses",
        previousCents: null,
      },
      recorder.db,
    );
    assert.equal(outcome.changed, false);
    assert.deepEqual(
      recorder.writes().map((write) => write.operation),
      ["milestone.updateMany"],
    );
  });

  test("a negative or fractional-cent amount is refused before anything is read", async () => {
    for (const cents of [-1, 10.5]) {
      const recorder = db();
      await assert.rejects(
        setMilestoneTradieFigure(
          adminPrincipal(),
          {
            cents,
            figure: "invoiced",
            milestoneId: "trusses",
            previousCents: null,
          },
          recorder.db,
        ),
        DomainValidationError,
      );
      assert.deepEqual(recorder.writes(), []);
    }
  });

  test("admin only, like the Financials tab", async () => {
    const recorder = db();
    await assert.rejects(
      setMilestoneTradieFigure(
        siteManagerPrincipal(),
        {
          cents: 100,
          figure: "quoted",
          milestoneId: "trusses",
          previousCents: null,
        },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});
