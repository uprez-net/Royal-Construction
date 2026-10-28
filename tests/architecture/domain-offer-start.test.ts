import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OfferStatus, Prisma } from "@prisma/client";
import { test } from "vitest";

import { DomainAuthorizationError } from "@/lib/domain/errors";
import { openOfferForLead } from "@/lib/domain/offers/start";
import { systemPrincipal } from "@/lib/domain/principal";
import { buildInitialOfferWorkspaceSnapshot } from "@/lib/offer/initial-workspace";
import { CURRENT_CALC_VERSION } from "@/lib/offer/calc-version";
import {
  INITIAL_COST_LINES,
  INITIAL_OFFER_JOB,
} from "@/lib/offer/workspace-model";
import {
  serializeWorkspace,
  validatePersistedWorkspace,
} from "@/lib/offer/workspace-persistence";
import { ROOT } from "./module-graph";
import { adminPrincipal, recordingDb } from "./domain-harness";

// Starting a lead's first offer used to be the offer page's alone, so Eve
// could edit an offer but never start one. lib/domain/offers/start.ts is the
// shared command, and lib/offer/initial-workspace.ts what the offer starts as.

const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const LEAD = { assignedId: null, id: 7 };

test("an existing live offer is returned as it is, and nothing is written", async () => {
  const existing = { id: "offer_1", leadId: 7, workspaceState: {} };
  const recorder = recordingDb({
    "lead.findUnique": LEAD,
    "offer.findFirst": existing,
  });

  const outcome = await openOfferForLead(
    adminPrincipal(),
    { leadId: 7 },
    recorder.transactionalDb,
  );

  assert.equal(outcome.created, false);
  assert.equal(outcome.offer, existing);
  assert.deepEqual(recorder.writes(), []);
});

test("a lead's first offer is minted a reference and opens pending, owned by the caller", async () => {
  const recorder = recordingDb({
    "lead.findUnique": LEAD,
    "offer.findFirst": null,
    "offerReferenceCounter.upsert": { lastSeq: 42, year: 2026 },
    "offer.create": (args: unknown) => ({
      id: "offer_new",
      ...(args as { data: object }).data,
    }),
  });

  const outcome = await openOfferForLead(
    adminPrincipal("user_estimator"),
    { leadId: 7 },
    recorder.transactionalDb,
    new Date("2026-10-28T00:00:00.000Z"),
  );

  assert.equal(outcome.created, true);
  const create = recorder
    .writes()
    .find((call) => call.operation === "offer.create");
  const data = (create?.args as { data: Record<string, unknown> }).data;
  assert.equal(data.baseReference, "RC-Q-2026-042");
  assert.equal(data.revisionNumber, 1);
  assert.equal(data.isActive, true);
  assert.equal(data.offerStatus, OfferStatus.PENDING);
  assert.equal(data.createdById, "user_estimator");
});

test("a second create for the same lead answers with the offer the first one made", async () => {
  // A double-click, or two tabs: the one-active-offer-per-lead index refuses
  // the second insert, and the caller gets the winner rather than an error.
  let finds = 0;
  const winner = { id: "offer_winner", leadId: 7, workspaceState: null };
  const recorder = recordingDb({
    "lead.findUnique": LEAD,
    "offer.findFirst": () => (finds++ === 0 ? null : winner),
    "offerReferenceCounter.upsert": { lastSeq: 1, year: 2026 },
    "offer.create": () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        clientVersion: "test",
        code: "P2002",
      });
    },
  });

  const outcome = await openOfferForLead(
    adminPrincipal(),
    { leadId: 7 },
    recorder.transactionalDb,
  );
  assert.equal(outcome.created, false);
  assert.equal(outcome.offer, winner);
});

test("an offer needs a team member to own it", async () => {
  const recorder = recordingDb({
    "lead.findUnique": LEAD,
    "offer.findFirst": null,
  });
  await assert.rejects(
    openOfferForLead(
      systemPrincipal("test"),
      { leadId: 7 },
      recorder.transactionalDb,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("the starting snapshot is one the workspace save accepts", () => {
  const now = new Date("2026-10-28T00:00:00.000Z");
  const snapshot = buildInitialOfferWorkspaceSnapshot(undefined, now);

  assert.equal(snapshot.calcVersion, CURRENT_CALC_VERSION);
  assert.equal(snapshot.lines, INITIAL_COST_LINES);
  assert.equal(snapshot.job.reference, INITIAL_OFFER_JOB.reference);
  // Valid for 30 days, so a new offer is never born expired.
  assert.ok(snapshot.job.validUntil > "2026-11-26");
  const validated = validatePersistedWorkspace(serializeWorkspace(snapshot));
  assert.ok(validated.ok, validated.ok ? "" : validated.error);
});

test("the screen and Eve start an offer from the same snapshot and the same command", () => {
  const workspace = read(
    "components/offers/new-workflow/new-offer-workspace.tsx",
  );
  assert.match(workspace, /buildInitialOfferWorkspaceSnapshot\(adminPrefill\)/);
  assert.match(
    read("agent/lib/offer-operations.ts"),
    /buildInitialOfferWorkspaceSnapshot\(/,
  );

  assert.match(read("lib/data/offer-workspace.ts"), /openOfferForLead\(/);
  assert.match(read("agent/lib/offer-operations.ts"), /openOfferForLead\(/);
  // The row is created in one place.
  assert.doesNotMatch(
    read("lib/data/offer-workspace.ts"),
    /tx\.offer\.create\(/,
  );
});
