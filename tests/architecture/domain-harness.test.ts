import assert from "node:assert/strict";
import { test } from "vitest";

import type { DomainDb } from "@/lib/domain/db";
import {
  DomainStaleVersionError,
  domainErrorStatus,
  isDomainError,
} from "@/lib/domain/errors";
import {
  attributionUserId,
  anonymousPrincipal,
  isInternalPrincipal,
  requireAdminPrincipal,
  requireUserPrincipal,
  systemPrincipal,
} from "@/lib/domain/principal";
import {
  adminPrincipal,
  assertSameWrites,
  customerPrincipal,
  recordingDb,
} from "./domain-harness";

// Self-tests for the Phase 0 foundation. The harness is what every later
// contract test stands on, so a harness that silently answers `undefined` to
// an unscripted read, or reports two different adapters as agreeing, would
// make the whole migration's test suite worthless.

// A stand-in for a migrated domain command: one optimistic-concurrency write,
// exactly the shape Phase 3's workspace save and Phase 6's admin content save
// both have.
async function bumpVersion(
  db: DomainDb,
  id: string,
  expectedVersion: number,
): Promise<number> {
  const row = await db.offer.findUnique({
    select: { stateVersion: true },
    where: { id },
  });
  if (!row) throw new DomainStaleVersionError();
  if (row.stateVersion !== expectedVersion) {
    throw new DomainStaleVersionError(
      undefined,
      expectedVersion,
      row.stateVersion,
    );
  }
  const updated = await db.offer.updateMany({
    data: { stateVersion: expectedVersion + 1 },
    where: { id, stateVersion: expectedVersion },
  });
  if (updated.count !== 1) throw new DomainStaleVersionError();
  return expectedVersion + 1;
}

test("an unscripted read fails loudly instead of answering undefined", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    () => bumpVersion(recorder.db, "offer_1", 3),
    /unscripted read offer.findUnique/,
  );
});

test("parallel unscripted reads all record their calls before rejecting", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    Promise.all([recorder.db.offer.findMany(), recorder.db.lead.findMany()]),
    /unscripted read/,
  );
  assert.deepEqual(recorder.operations(), ["offer.findMany", "lead.findMany"]);
});

test("createManyAndReturn defaults to Prisma's array result shape", async () => {
  const recorder = recordingDb();
  const db = recorder.db as unknown as {
    example: {
      createManyAndReturn(args: unknown): Promise<unknown[]>;
    };
  };

  assert.deepEqual(await db.example.createManyAndReturn({ data: [] }), []);
});

test("the recorder replays scripted reads and records writes in order", async () => {
  const recorder = recordingDb({
    "offer.findUnique": { stateVersion: 3 },
    "offer.updateMany": { count: 1 },
  });

  assert.equal(await bumpVersion(recorder.db, "offer_1", 3), 4);
  assert.deepEqual(recorder.operations(), [
    "offer.findUnique",
    "offer.updateMany",
  ]);
  assert.deepEqual(recorder.writes(), [
    {
      args: {
        data: { stateVersion: 4 },
        where: { id: "offer_1", stateVersion: 3 },
      },
      operation: "offer.updateMany",
    },
  ]);
});

test("a lost optimistic-concurrency race throws and writes nothing further", async () => {
  const recorder = recordingDb({ "offer.findUnique": { stateVersion: 5 } });

  await assert.rejects(
    () => bumpVersion(recorder.db, "offer_1", 3),
    (error) => {
      assert.ok(error instanceof DomainStaleVersionError);
      assert.equal(error.expected, 3);
      assert.equal(error.actual, 5);
      assert.equal(domainErrorStatus(error), 409);
      return true;
    },
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a conditional update that matched no row is a stale version, not a success", async () => {
  // The `where` carries the version, so a concurrent save makes the update
  // match nothing. With two or three staff on a shared login this is one
  // person in two tabs, or a retry after a timeout — not a rare race.
  const recorder = recordingDb({
    "offer.findUnique": { stateVersion: 3 },
    "offer.updateMany": { count: 0 },
  });

  await assert.rejects(
    () => bumpVersion(recorder.db, "offer_1", 3),
    DomainStaleVersionError,
  );
});

test("$transaction runs against the same recorder, so calls stay in order", async () => {
  const recorder = recordingDb({
    "offer.findUnique": { stateVersion: 1 },
    "offer.updateMany": { count: 1 },
  });

  const db = recorder.db as unknown as {
    $transaction: <T>(fn: (tx: DomainDb) => Promise<T>) => Promise<T>;
  };
  await db.$transaction((tx) => bumpVersion(tx, "offer_1", 1));

  assert.deepEqual(recorder.operations(), [
    "offer.findUnique",
    "offer.updateMany",
  ]);
});

test("assertSameWrites passes for two adapters on the same command", async () => {
  const script = {
    "offer.findUnique": { stateVersion: 2 },
    "offer.updateMany": { count: 1 },
  };
  const viaApp = recordingDb(script);
  const viaEve = recordingDb(script);

  await bumpVersion(viaApp.db, "offer_1", 2);
  await bumpVersion(viaEve.db, "offer_1", 2);

  assertSameWrites(viaApp, viaEve, assert.deepEqual, "bumpVersion");
});

test("assertSameWrites fails when one adapter writes something else", async () => {
  const script = {
    "offer.findUnique": { stateVersion: 2 },
    "offer.updateMany": { count: 1 },
  };
  const viaApp = recordingDb(script);
  const viaEve = recordingDb(script);

  await bumpVersion(viaApp.db, "offer_1", 2);
  // Eve's own copy of the rule, with the version dropped out of the `where` —
  // a last-write-wins save where the app refuses. Exactly the drift this
  // migration exists to end, and invisible to a test that only checked both
  // paths returned success.
  await viaEve.db.offer.updateMany({
    data: { stateVersion: 3 },
    where: { id: "offer_1" },
  });

  assert.throws(() =>
    assertSameWrites(viaApp, viaEve, assert.deepEqual, "bumpVersion"),
  );
});

test("principals answer who to attribute a write to", () => {
  assert.equal(attributionUserId(adminPrincipal("user_1")), "user_1");
  assert.equal(
    attributionUserId(systemPrincipal("cron:tradie-reminders")),
    null,
  );
  assert.equal(
    attributionUserId(anonymousPrincipal("book-consultation")),
    null,
  );
});

test("a cron is internal; an open booking route and a customer are not", () => {
  assert.equal(isInternalPrincipal(adminPrincipal()), true);
  assert.equal(isInternalPrincipal(systemPrincipal("cron:compliance")), true);
  assert.equal(isInternalPrincipal(customerPrincipal()), false);
  assert.equal(
    isInternalPrincipal(anonymousPrincipal("book-consultation")),
    false,
  );
});

test("requireUserPrincipal and requireAdminPrincipal refuse with domain errors", () => {
  assert.throws(
    () => requireUserPrincipal(anonymousPrincipal("webhook:lead")),
    (error) => isDomainError(error) && error.status === 403,
  );
  assert.throws(
    () => requireAdminPrincipal(customerPrincipal()),
    (error) => isDomainError(error) && error.code === "domain_unauthorized",
  );
  // A cron reaching an admin command authenticated on its own channel.
  assert.doesNotThrow(() =>
    requireAdminPrincipal(systemPrincipal("cron:tradie-reminders")),
  );
});
