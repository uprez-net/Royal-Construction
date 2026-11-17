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
    assert.equal(voiceLookupsFor(adminCaller).length, 6);
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
