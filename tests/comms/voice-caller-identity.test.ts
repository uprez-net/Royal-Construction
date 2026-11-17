import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { describe, test } from "vitest";

import {
  classifyCallerMatches,
  type CallerMatch,
} from "@/lib/domain/comms/callers/identity";
import { resolveVoiceCaller } from "@/lib/domain/comms/callers/resolve";

import {
  auditRows,
  CALL_ID,
  CALLER,
  callerDb,
  PROVIDER_CALL_ID,
  authority,
} from "./voice-caller-fixtures";

// Who a number resolves to (issue #528): one number, one caller — or nobody,
// and the resolver on the call failing closed.

const admin = (id = "u-1", name = "Alex Admin"): CallerMatch => ({
  customerId: null,
  id,
  kind: "user",
  name,
  role: Role.ADMIN,
});
const user = (role: Role, customerId: string | null = null): CallerMatch => ({
  customerId,
  id: `u-${role}`,
  kind: "user",
  name: "Pat Person",
  role,
});
const customer = (id: string, name = "Chris Client"): CallerMatch => ({
  id,
  kind: "customer",
  name,
});
const lead = (
  id: number,
  personName: string,
  extra: Partial<Extract<CallerMatch, { kind: "lead" }>> = {},
): CallerMatch => ({
  archived: false,
  id,
  kind: "lead",
  personName,
  projectCustomerIds: [],
  projectId: null,
  via: "primary",
  ...extra,
});
const tradie = (id: string, archived = false): CallerMatch => ({
  archived,
  id,
  kind: "tradie",
  name: "Terry Tradie",
});

// ── Who is calling ───────────────────────────────────────────────────

describe("one number, one caller — or nobody", () => {
  test("each class resolves from its own record", () => {
    assert.deepEqual(classifyCallerMatches([admin()]), {
      class: "admin",
      firstName: "Alex",
      userId: "u-1",
    });
    assert.equal(
      classifyCallerMatches([user(Role.SITE_MANAGER)]).class,
      "site_manager",
    );
    assert.deepEqual(classifyCallerMatches([tradie("t-1")]), {
      class: "tradie",
      firstName: "Terry",
      tradieId: "t-1",
    });
    assert.deepEqual(classifyCallerMatches([customer("c-1")]), {
      class: "client",
      customerIds: ["c-1"],
      firstName: "Chris",
      leadIds: [],
    });
    assert.deepEqual(classifyCallerMatches([lead(4, "Lee Lead")]), {
      class: "client",
      customerIds: [],
      firstName: "Lee",
      leadIds: [4],
    });
    assert.deepEqual(classifyCallerMatches([]), {
      class: "unknown",
      reason: "unmatched",
    });
  });

  test("a customer, their portal account and the lead their project came from are one subject", () => {
    assert.deepEqual(
      classifyCallerMatches([
        customer("c-1"),
        user(Role.CUSTOMER, "c-1"),
        lead(7, "Someone Else", {
          projectCustomerIds: ["c-1", "c-2"],
          projectId: "p-1",
        }),
      ]),
      {
        class: "client",
        customerIds: ["c-1"],
        firstName: "Chris",
        leadIds: [7],
      },
    );
  });

  test("two leads join through a project owner only when that owner matched the number too", () => {
    const leads = [
      lead(1, "Jo Smith", { projectCustomerIds: ["c-9"], projectId: "p-1" }),
      lead(2, "Joanne Smith", {
        projectCustomerIds: ["c-9"],
        projectId: "p-2",
      }),
    ];
    // c-9 did not match this number: nothing says these are one person.
    assert.deepEqual(classifyCallerMatches(leads), {
      class: "unknown",
      reason: "ambiguous",
    });
    const viaMatchedOwner = classifyCallerMatches([
      ...leads,
      customer("c-9", "Jo Smith"),
    ]);
    assert.deepEqual(
      viaMatchedOwner.class === "client" && viaMatchedOwner.leadIds,
      [1, 2],
    );
  });

  test("a shared name joins only enquiries with no project yet", () => {
    const repeat = classifyCallerMatches([
      lead(3, "Jo Smith"),
      lead(4, "  jo  SMITH "),
    ]);
    assert.deepEqual(repeat.class === "client" && repeat.leadIds, [3, 4]);
    for (const matches of [
      // Two customers, or a customer and an unrelated lead, by name alone.
      [customer("c-1", "Jo Smith"), customer("c-2", "Jo Smith")],
      [customer("c-1", "Jo Smith"), lead(5, "Jo Smith")],
      // A lead whose project the number's other match does not own.
      [
        lead(6, "Jo Smith"),
        lead(7, "Jo Smith", { projectCustomerIds: ["c-8"], projectId: "p" }),
      ],
    ]) {
      assert.deepEqual(classifyCallerMatches(matches), {
        class: "unknown",
        reason: "ambiguous",
      });
    }
  });

  test("a second person or a second role fails closed — never the first row, never a union", () => {
    const cases: CallerMatch[][] = [
      [lead(1, "Jo Smith"), lead(2, "Sam Jones")],
      [admin(), lead(5, "Alex Admin")],
      [user(Role.SITE_MANAGER), customer("c-1")],
      [tradie("t-1"), customer("c-1")],
      [tradie("t-1"), tradie("t-2")],
      [admin(), tradie("t-1")],
      [customer("c-1", "Chris Client"), customer("c-2", "Dana Other")],
      // A lead whose project belongs to somebody else, with another name.
      [
        customer("c-1", "Chris Client"),
        lead(8, "Dana Other", { projectCustomerIds: ["c-5"], projectId: "p" }),
      ],
    ];
    for (const matches of cases) {
      assert.deepEqual(
        classifyCallerMatches(matches),
        { class: "unknown", reason: "ambiguous" },
        JSON.stringify(matches.map((m) => `${m.kind}:${m.id}`)),
      );
    }
  });

  test("unsupported and inactive records grant nothing, and still block a second person", () => {
    assert.deepEqual(classifyCallerMatches([user(Role.GUEST)]), {
      class: "unknown",
      reason: "unsupported",
    });
    assert.deepEqual(classifyCallerMatches([user(Role.CUSTOMER, null)]), {
      class: "unknown",
      reason: "unsupported",
    });
    assert.deepEqual(classifyCallerMatches([tradie("t-1", true)]), {
      class: "unknown",
      reason: "inactive",
    });
    assert.deepEqual(
      classifyCallerMatches([lead(1, "Jo Smith", { archived: true })]),
      { class: "unknown", reason: "inactive" },
    );
    assert.deepEqual(
      classifyCallerMatches([user(Role.GUEST), lead(1, "Jo Smith")]),
      { class: "unknown", reason: "ambiguous" },
    );
    assert.deepEqual(
      classifyCallerMatches([tradie("t-1", true), customer("c-1")]),
      { class: "unknown", reason: "ambiguous" },
    );
    // An archived enquiry of the same person grants nothing but blocks nothing.
    const sameSubject = classifyCallerMatches([
      lead(1, "Jo Smith", { archived: true }),
      lead(2, "Jo Smith"),
    ]);
    assert.deepEqual(
      sameSubject.class === "client" && sameSubject.leadIds,
      [2],
    );
  });

  test("a secondary client is matched under their own name", () => {
    const resolved = classifyCallerMatches([
      lead(3, "Second Person", { via: "secondary" }),
    ]);
    assert.equal(resolved.class === "client" && resolved.firstName, "Second");
  });
});

describe("resolving the caller on the call", () => {
  test("switched off: no read, no audit, message taking", async () => {
    const recorder = callerDb("admin");
    const caller = await resolveVoiceCaller(
      authority,
      { enabled: false },
      recorder.db,
    );
    assert.deepEqual(caller.identity, { class: "unknown", reason: "disabled" });
    assert.equal(caller.verification, null);
    assert.deepEqual(recorder.calls, []);
  });

  test("a stream that is not this inbound call resolves nobody and writes nothing", async () => {
    for (const call of [
      null,
      {
        customerNumber: CALLER,
        direction: "OUTBOUND",
        providerCallId: PROVIDER_CALL_ID,
      },
      {
        customerNumber: CALLER,
        direction: "INBOUND",
        providerCallId: "v3:other",
      },
    ]) {
      const recorder = callerDb("admin", { "call.findUnique": call });
      const caller = await resolveVoiceCaller(
        authority,
        { enabled: true },
        recorder.db,
      );
      assert.equal(caller.identity.class, "unknown");
      assert.deepEqual(recorder.writes(), []);
      assert.ok(!recorder.operations().includes("$.queryRaw"));
    }
  });

  test("withheld and invalid numbers get no lookup at all", async () => {
    for (const customerNumber of ["withheld", "anonymous", "+61 1"]) {
      const recorder = callerDb("admin", {
        "call.findUnique": {
          customerNumber,
          direction: "INBOUND",
          providerCallId: PROVIDER_CALL_ID,
        },
      });
      const caller = await resolveVoiceCaller(
        authority,
        { enabled: true },
        recorder.db,
      );
      assert.deepEqual(caller.identity, {
        class: "unknown",
        reason: "withheld",
      });
      assert.ok(!recorder.operations().includes("$.queryRaw"));
      assert.deepEqual(auditRows(recorder), [
        {
          callId: CALL_ID,
          callerClass: "UNKNOWN",
          kind: "RESOLVED",
          outcome: "withheld",
          queryName: null,
          recordIds: [],
          verification: null,
        },
      ]);
    }
  });

  test("every stored format of the same number resolves the same; a different number sharing the digits does not", async () => {
    for (const phone of [
      "+61412555678",
      "+61 412 555 678",
      "0412 555 678",
      "0412-555-678",
      "0061412555678",
    ]) {
      const recorder = callerDb("admin", {
        "$.queryRaw": [
          { e164: null, id: "u-admin", phone, source: "user" },
          // Ends in the same nine digits, but is a UK mobile.
          {
            e164: null,
            id: "t-uk",
            phone: "+44 7412 555678",
            source: "tradie",
          },
        ],
        "user.findUnique": undefined,
      });
      const caller = await resolveVoiceCaller(
        authority,
        { enabled: true },
        recorder.db,
      );
      assert.equal(caller.identity.class, "admin", phone);
      assert.ok(
        !recorder.operations().includes("tradie.findMany"),
        "the UK number was never treated as a match",
      );
    }
  });

  test("a resolution is audited with ids and the method, never the number", async () => {
    const recorder = callerDb("tradie");
    const caller = await resolveVoiceCaller(
      authority,
      { enabled: true },
      recorder.db,
    );
    assert.equal(caller.identity.class, "tradie");
    assert.equal(caller.verification, "caller_id");
    const [row] = auditRows(recorder);
    assert.deepEqual(row, {
      callId: CALL_ID,
      callerClass: "TRADIE",
      kind: "RESOLVED",
      outcome: "matched",
      queryName: null,
      recordIds: ["tradie:t-1"],
      verification: "caller_id",
    });
    assert.ok(!JSON.stringify(recorder.writes()).includes("412555678"));
  });

  test("more candidate records than one person could hold is ambiguous", async () => {
    const recorder = callerDb("lead", {
      "$.queryRaw": Array.from({ length: 41 }, (_, i) => ({
        e164: CALLER,
        id: String(i),
        phone: CALLER,
        source: "lead",
      })),
    });
    const caller = await resolveVoiceCaller(
      authority,
      { enabled: true },
      recorder.db,
    );
    assert.deepEqual(caller.identity, {
      class: "unknown",
      reason: "ambiguous",
    });
  });
});

describe("people who share one number stay two people", () => {
  test("a lead's primary and secondary contact on one number are ambiguous unless they are one name", () => {
    assert.deepEqual(
      classifyCallerMatches([
        lead(3, "Jo Smith", { via: "primary" }),
        lead(3, "Sam Smith", { via: "secondary" }),
      ]),
      { class: "unknown", reason: "ambiguous" },
    );
    const samePerson = classifyCallerMatches([
      lead(3, "Jo Smith", { via: "primary" }),
      lead(3, "Jo Smith", { via: "secondary" }),
    ]);
    assert.deepEqual(samePerson.class === "client" && samePerson.leadIds, [3]);
  });

  test("two customers co-owning the matched lead's project are not merged into one", () => {
    assert.deepEqual(
      classifyCallerMatches([
        customer("c-1", "Chris Client"),
        customer("c-2", "Dana Client"),
        lead(7, "Chris Client", {
          projectCustomerIds: ["c-1", "c-2"],
          projectId: "p-1",
        }),
      ]),
      { class: "unknown", reason: "ambiguous" },
    );
  });
});
