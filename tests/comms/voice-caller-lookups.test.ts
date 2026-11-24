import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { describe, test } from "vitest";

import { parseLookupCall } from "@/lib/comms/voice-agent/desk";
import {
  MAX_RECORD_IDS,
  recordCallerAccess,
} from "@/lib/domain/comms/callers/audit";
import {
  runVoiceLookup,
  voiceLookupsFor,
} from "@/lib/domain/comms/callers/lookups";
import { DomainAuthorizationError } from "@/lib/domain/errors";

import {
  auditRows,
  CALLER,
  callerDb,
  NOW,
  principal,
} from "./voice-caller-fixtures";

// The admin lookup catalogue (issue #528): only an admin may run one, every
// refusal is audited and reads nothing, and an answer is audited by ids.

// ── Lookups ──────────────────────────────────────────────────────────

describe("the admin lookup catalogue", () => {
  const adminCaller = principal({
    class: "admin",
    firstName: "Alex",
    userId: "u-admin",
  });

  test("only an admin is offered lookups", () => {
    for (const identity of [
      { class: "site_manager", firstName: null, userId: "u-sm" },
      { class: "tradie", firstName: null, tradieId: "t-1" },
      { class: "client", customerIds: ["c-1"], firstName: null, leadIds: [] },
      { class: "unknown", reason: "unmatched" },
    ] as const) {
      assert.deepEqual(voiceLookupsFor(principal(identity)), []);
    }
    assert.equal(voiceLookupsFor(adminCaller).length, 7);
  });

  test("every other class is refused, audited, and reads nothing", async () => {
    for (const identity of [
      { class: "site_manager", firstName: null, userId: "u-sm" },
      { class: "tradie", firstName: null, tradieId: "t-1" },
      { class: "client", customerIds: ["c-1"], firstName: null, leadIds: [7] },
    ] as const) {
      const recorder = callerDb("admin");
      await assert.rejects(
        runVoiceLookup(
          principal(identity),
          { name: "project_financials", project: "Ridge" },
          recorder.db,
          { now: NOW },
        ),
        DomainAuthorizationError,
      );
      assert.deepEqual(
        recorder.operations(),
        ["callerAccessEvent.create"],
        "nothing is read for a refused lookup",
      );
      assert.equal(auditRows(recorder)[0].kind, "REFUSED");
      assert.equal(auditRows(recorder)[0].queryName, "project_financials");
    }
  });

  test("an admin's lookup re-checks them, runs the app's own read, and is audited by name and ids", async () => {
    const recorder = callerDb("admin", {
      "project.count": 1,
      "project.findMany": [
        { id: "p-1", location: "1 Example St", name: "Ridge Street Build" },
      ],
      "project.findFirstOrThrow": {
        id: "p-1",
        location: "1 Example St",
        milestones: [],
        name: "Ridge Street Build",
        siteManager: { name: "Sam Site" },
        status: "DELAYED",
        tradieSchedules: [],
      },
    });
    const result = await runVoiceLookup(
      adminCaller,
      { name: "project_status", project: "Ridge" },
      recorder.db,
      { now: NOW },
    );
    assert.match(result.text, /Ridge Street Build at 1 Example St: delayed/);
    assert.match(result.text, /Site manager: Sam Site/);
    assert.equal(recorder.operations()[0], "user.findUnique");
    const lookupRow = auditRows(recorder).at(-1);
    assert.equal(lookupRow?.kind, "LOOKUP");
    assert.equal(lookupRow?.queryName, "project_status");
    assert.deepEqual(lookupRow?.recordIds, ["project:p-1"]);
  });

  test("several matching projects are listed for the caller to choose, not guessed", async () => {
    const recorder = callerDb("admin", {
      "project.count": 2,
      "project.findMany": [
        { id: "p-1", location: "1 Example St", name: "Smith North" },
        { id: "p-2", location: "9 Other Rd", name: "Smith South" },
      ],
    });
    const result = await runVoiceLookup(
      adminCaller,
      { name: "project_financials", project: "Smith" },
      recorder.db,
      { now: NOW },
    );
    assert.match(result.text, /2 projects match "Smith"; ask which one/);
    assert.ok(!recorder.operations().includes("invoice.findMany"));
  });

  test("an admin demoted mid-call is refused before the read", async () => {
    const recorder = callerDb("admin", {
      "user.findUnique": {
        customerId: null,
        id: "u-admin",
        phone: CALLER,
        role: Role.SITE_MANAGER,
      },
    });
    await assert.rejects(
      runVoiceLookup(adminCaller, { name: "pipeline_summary" }, recorder.db, {
        now: NOW,
      }),
      DomainAuthorizationError,
    );
    assert.ok(!recorder.operations().includes("lead.groupBy"));
    assert.equal(auditRows(recorder)[0].outcome, "identity_changed");
  });

  test("the desk's arguments are shape-checked, and ids the model invents are dropped", () => {
    assert.deepEqual(
      parseLookupCall("project_status", {
        project: "Smith",
        projectId: "someone-elses-id",
      }),
      { name: "project_status", project: "Smith" },
    );
    assert.equal(parseLookupCall("project_status", {}), null);
    assert.equal(
      parseLookupCall("bookings_between", { when: "forever" }),
      null,
    );
    assert.equal(parseLookupCall("run_sql", { query: "select 1" }), null);
    assert.deepEqual(parseLookupCall("pipeline_summary", undefined), {
      name: "pipeline_summary",
    });
  });
});

describe("periods and the audit trail", () => {
  test("this week and next week are Monday-to-Sunday calendar weeks in Sydney", async () => {
    // NOW is Tuesday 17 November 2026, midday in Sydney (AEDT, UTC+11).
    const ranges: Record<string, { gte: Date; lt: Date }> = {};
    for (const when of ["this_week", "next_week"] as const) {
      const recorder = callerDb("admin", { "tradieSchedule.findMany": [] });
      await runVoiceLookup(
        principal({ class: "admin", firstName: "Alex", userId: "u-admin" }),
        { name: "bookings_between", when },
        recorder.db,
        { now: NOW },
      );
      const [read] = recorder.calls.filter(
        (call) => call.operation === "tradieSchedule.findMany",
      );
      ranges[when] = (
        read.args as { where: { scheduledDate: { gte: Date; lt: Date } } }
      ).where.scheduledDate;
    }
    assert.deepEqual(ranges.this_week, {
      gte: new Date("2026-11-15T13:00:00Z"),
      lt: new Date("2026-11-22T13:00:00Z"),
    });
    assert.deepEqual(ranges.next_week, {
      gte: new Date("2026-11-22T13:00:00Z"),
      lt: new Date("2026-11-29T13:00:00Z"),
    });
  });

  test("a disclosure that read more ids than one row holds is written whole, across rows", async () => {
    const recorder = callerDb("admin");
    const ids = Array.from(
      { length: MAX_RECORD_IDS * 2 + 5 },
      (_, i) => `booking:${i}`,
    );
    await recordCallerAccess(
      principal({ class: "admin", firstName: "Alex", userId: "u-admin" }),
      {
        kind: "LOOKUP",
        outcome: "ok",
        queryName: "bookings_between",
        recordIds: ids,
      },
      recorder.db,
    );
    const rows = auditRows(recorder);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.flatMap((row) => row.recordIds as string[]),
      ids,
    );
    assert.ok(
      rows.every((row) => (row.recordIds as string[]).length <= MAX_RECORD_IDS),
    );
    assert.ok(rows.every((row) => row.queryName === "bookings_between"));
    assert.deepEqual(
      recorder.writes().map((call) => call.operation),
      ["callerAccessEvent.createMany"],
      "one statement: the entry is written whole or not at all",
    );
  });
});

// #621: Mili resolves the record a caller means through the same context
// index the office agent searches, then reads it live under the caller's
// own scope.
describe("lookups through the context index", () => {
  const adminCaller = principal({
    class: "admin",
    firstName: "Alex",
    userId: "u-admin",
  });

  function indexRow(row: Record<string, unknown>) {
    return {
      content: "",
      dueAt: null,
      refreshedAt: NOW,
      section: "overview",
      tags: [],
      ...row,
    };
  }

  test('a project said as "Street" is found when it was saved as "St"', async () => {
    const recorder = callerDb("admin", {
      "agentContextChunk.findMany": [
        indexRow({
          entityId: "p-1",
          keywords: ["12 example st", "12 example street", "oran park"],
          kind: "project",
          title: "Ridge Street Build — 12 Example St, Oran Park",
        }),
      ],
      "project.findFirstOrThrow": {
        id: "p-1",
        location: "12 Example St, Oran Park",
        milestones: [],
        name: "Ridge Street Build",
        siteManager: null,
        status: "ACTIVE",
        tradieSchedules: [],
      },
      "project.findMany": [
        {
          id: "p-1",
          location: "12 Example St, Oran Park",
          name: "Ridge Street Build",
        },
      ],
    });
    const result = await runVoiceLookup(
      adminCaller,
      { name: "project_status", project: "12 Example Street" },
      recorder.db,
      { now: NOW },
    );
    assert.match(result.text, /Ridge Street Build/);
    const ops = recorder.operations();
    assert.ok(
      ops.indexOf("agentContextChunk.findMany")
        < ops.indexOf("project.findMany"),
      "the index is asked first, then the project is read live",
    );
    const live = recorder.calls.find(
      (call) => call.operation === "project.findMany",
    );
    assert.deepEqual((live?.args as { where: { id: unknown } }).where.id, {
      in: ["p-1"],
    });
  });

  const offerRow = {
    baseReference: "RC-2026-014",
    contractValueIncGst: 612500,
    id: "o-1",
    lead: { location: "12 Example St", name: "Lee Lead" },
    leadId: 9,
    offerStatus: "OFFER_SENT",
    revisionNumber: 2,
    sentAt: new Date("2026-11-20T00:00:00Z"),
    totalAmount: 600000,
    updatedAt: new Date("2026-11-21T00:00:00Z"),
  };

  test("an offer reference said with spaces finds the offer, and an admin hears its value", async () => {
    const recorder = callerDb("admin", {
      "agentContextChunk.findMany": [
        indexRow({
          entityId: "9",
          keywords: ["rc 2026 014", "rc2026014", "rc 2026 014 r2"],
          kind: "offer",
          title: "RC-2026-014-R2 — Lee Lead, 12 Example St",
        }),
      ],
      "offer.findMany": [offerRow],
    });
    const result = await runVoiceLookup(
      adminCaller,
      { name: "offer_status", offer: "RC 2026 014" },
      recorder.db,
      { now: NOW },
    );
    assert.match(result.text, /RC-2026-014-R2 for Lee Lead/);
    assert.match(result.text, /offer sent/);
    assert.match(result.text, /Value: .* including GST/);
    assert.deepEqual(auditRows(recorder).at(-1)?.recordIds, ["offer:o-1"]);
  });

  test("a caller who may not see money is never told an offer's value", async () => {
    const { offerStatus } =
      await import("@/lib/domain/comms/callers/lookup-reads");
    const { userPrincipal } = await import("@/lib/domain/principal");
    const recorder = callerDb("admin", {
      "offer.findMany": (args: { select?: { isActive?: boolean } }) =>
        // The fallback search, then the live read: both see the one offer.
        args.select?.isActive ? [{ ...offerRow, isActive: true }] : [offerRow],
    });
    const result = await offerStatus(
      userPrincipal({ id: "u-sm", role: Role.SITE_MANAGER }),
      "RC-2026-014",
      recorder.db,
      NOW,
    );
    assert.match(result.text, /RC-2026-014-R2 for Lee Lead/);
    assert.doesNotMatch(result.text, /Value|\$/);
  });

  test("a revision that is no longer current is called superseded, not answered with the current one", async () => {
    const recorder = callerDb("admin", {
      "agentContextChunk.findMany": [
        indexRow({
          entityId: "9",
          keywords: ["rc 2026 014", "rc2026014", "rc 2026 014 r2"],
          kind: "offer",
          title: "RC-2026-014-R2 — Lee Lead, 12 Example St",
        }),
      ],
      "offer.findMany": [offerRow],
    });
    const result = await runVoiceLookup(
      adminCaller,
      { name: "offer_status", offer: "RC-2026-014-R1" },
      recorder.db,
      { now: NOW },
    );
    assert.match(result.text, /RC-2026-014-R1 has been superseded/);
    assert.match(result.text, /current offer for Lee Lead is RC-2026-014-R2/);
    assert.doesNotMatch(result.text, /offer sent|Value|\$/);
  });

  test("a spoken reference falls back to the stored form when the index has nothing live", async () => {
    const { offerStatus } =
      await import("@/lib/domain/comms/callers/lookup-reads");
    const { userPrincipal } = await import("@/lib/domain/principal");
    const searched: string[] = [];
    const recorder = callerDb("admin", {
      "offer.findMany": (args: {
        select?: { isActive?: boolean };
        where?: { OR?: { baseReference?: { contains?: string } }[] };
      }) => {
        if (!args.select?.isActive) return [offerRow];
        const query = args.where?.OR?.[1]?.baseReference?.contains ?? "";
        searched.push(query);
        return query === "rc-2026-014" ? [{ ...offerRow, isActive: true }] : [];
      },
    });
    const result = await offerStatus(
      userPrincipal({ id: "u-admin", role: Role.ADMIN }),
      "RC 2026 014",
      recorder.db,
      NOW,
    );
    assert.deepEqual(searched, ["RC 2026 014", "rc-2026-014"]);
    assert.match(result.text, /RC-2026-014-R2 for Lee Lead/);
  });
});
