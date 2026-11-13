import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  assessProjectAttention,
  needingAttention,
  type AttentionSource,
} from "@/lib/domain/projects/attention";

// Issues #451 and #452: Needs Attention is derived from the project's live
// records, Drafting is "no activity started", and the overdue alert is the
// Milestones tab's own rule evaluated on Sydney's calendar.

// 9am Sydney on Fri 13 Nov 2026 (AEDT, UTC+11).
const NOW = new Date("2026-11-12T22:00:00Z");

function milestone(
  overrides: Partial<AttentionSource["milestones"][number]> = {},
): AttentionSource["milestones"][number] {
  return {
    id: "m1",
    name: "Slab",
    status: "PENDING",
    // Sydney midnight, 20 Nov: well in the future.
    targetDate: new Date("2026-11-19T13:00:00Z"),
    startDate: null,
    estimatedDays: 2,
    requiredTradeTypes: [],
    ...overrides,
  };
}

function project(overrides: Partial<AttentionSource> = {}): AttentionSource {
  return {
    id: "p1",
    name: "Smith residence",
    location: "1 Example St",
    status: "DRAFT",
    requirements: {
      legalAdministration: {
        signedDate: "2026-10-01",
        pcaInspector: "Jane Certifier",
        hbcfInsuranceNumber: "HBCF-1",
      },
    },
    customer: { name: "Sam Smith" },
    milestones: [milestone()],
    tradieSchedules: [],
    variations: [],
    checklists: [],
    certifierEngagement: null,
    ...overrides,
  };
}

const kinds = (source: AttentionSource) =>
  assessProjectAttention(source, NOW).conditions.map((c) => c.kind);

describe("Drafting", () => {
  test("a project with no activity started is drafting", () => {
    assert.equal(assessProjectAttention(project(), NOW).drafting, true);
  });

  test("it stays drafting through compliance and trade booking", () => {
    const inCompliance = project({
      status: "COMPLIANCE_STARTED",
      tradieSchedules: [
        {
          milestoneId: "m1",
          status: "PENDING",
          trade: "Concreter",
          tradie: { trade: "Concreter" },
        },
      ],
    });
    assert.equal(assessProjectAttention(inCompliance, NOW).drafting, true);
  });

  test("the first started activity ends it", () => {
    const started = project({
      milestones: [milestone({ status: "ACTIVE", startDate: NOW })],
    });
    assert.equal(assessProjectAttention(started, NOW).drafting, false);
  });
});

describe("Needs Attention", () => {
  test("a clean project has no conditions", () => {
    assert.deepEqual(kinds(project()), []);
    assert.deepEqual(
      needingAttention([assessProjectAttention(project(), NOW)]),
      [],
    );
  });

  test("an activity past its estimated end is overdue, with the detail the alert shows", () => {
    // Planned 1 Nov Sydney, two days: due 3 Nov, ten days overdue on the 13th.
    const late = project({
      milestones: [milestone({ targetDate: new Date("2026-10-31T13:00:00Z") })],
    });
    const attention = assessProjectAttention(late, NOW);
    assert.deepEqual(
      attention.conditions.map((c) => c.kind),
      ["OVERDUE"],
    );
    assert.equal(attention.overdue.length, 1);
    assert.equal(attention.overdue[0].name, "Slab");
    assert.equal(attention.overdue[0].daysOverdue, 10);
    assert.equal(
      attention.overdue[0].expectedCompletion,
      new Date("2026-11-02T13:00:00Z").toISOString(),
    );
  });

  test("overdue is judged on Sydney's calendar, not the server's UTC one", () => {
    // Due 10:00Z on 12 Nov: 9pm on the 12th in Sydney. Now is 22:00Z on the
    // 12th, 9am on the 13th in Sydney. On Sydney's calendar that is a day
    // overdue; on UTC's both are the 12th and it would read "due today".
    const dueYesterday = project({
      milestones: [
        milestone({
          targetDate: new Date("2026-11-10T10:00:00Z"),
          estimatedDays: 2,
        }),
      ],
    });
    assert.equal(
      assessProjectAttention(dueYesterday, NOW).overdue[0]?.daysOverdue,
      1,
    );
  });

  test("finished and waived activities are never overdue", () => {
    const settled = project({
      milestones: [
        milestone({
          id: "a",
          status: "DONE",
          targetDate: new Date("2026-10-01T00:00:00Z"),
        }),
        milestone({
          id: "b",
          status: "NOT_REQUIRED",
          targetDate: new Date("2026-10-01T00:00:00Z"),
        }),
      ],
    });
    assert.ok(!kinds(settled).includes("OVERDUE"));
  });

  test("open compliance alerts, unresolved issues and pending variations each count", () => {
    const busy = project({
      certifierEngagement: {
        alerts: [{ status: "OPEN" }, { status: "OPEN" }],
        documents: [],
      },
      checklists: [{ issues: [{ status: "OPEN" }, { status: "IN_PROGRESS" }] }],
      variations: [{ status: "PENDING" }],
    });
    const attention = assessProjectAttention(busy, NOW);
    assert.deepEqual(
      attention.conditions.map((c) => [c.kind, c.count]),
      [
        ["COMPLIANCE_ALERT", 2],
        ["ISSUE", 2],
        ["VARIATION", 1],
      ],
    );
    // Drafting and needing attention at once: neither replaces the other.
    assert.equal(attention.drafting, true);
  });

  test("resolved things clear their condition", () => {
    const resolved = project({
      certifierEngagement: { alerts: [{ status: "RESOLVED" }], documents: [] },
      checklists: [{ issues: [{ status: "VERIFIED" }] }],
      variations: [{ status: "APPROVED" }],
    });
    assert.deepEqual(kinds(resolved), []);
  });

  test("missing build documents are flagged once work has started, not before", () => {
    const drafting = project();
    assert.ok(!kinds(drafting).includes("MISSING_DOCUMENT"));

    const started = project({
      status: "ACTIVE",
      milestones: [milestone({ status: "ACTIVE", startDate: NOW })],
      certifierEngagement: {
        alerts: [],
        documents: [
          {
            documentType: "CONSTRUCTION_CERTIFICATE",
            _count: { files: 1 },
          },
          // A row with no file on it is not a document held.
          { documentType: "HOME_INSURANCE", _count: { files: 0 } },
        ],
      },
    });
    const missing = assessProjectAttention(started, NOW).conditions.find(
      (c) => c.kind === "MISSING_DOCUMENT",
    );
    assert.equal(missing?.label, "Missing HBCF certificate");
  });

  test("the readiness gaps count once work has started", () => {
    const started = project({
      status: "ACTIVE",
      requirements: { legalAdministration: { signedDate: "2026-10-01" } },
      milestones: [milestone({ status: "ACTIVE", startDate: NOW })],
      certifierEngagement: {
        alerts: [],
        documents: [
          { documentType: "CONSTRUCTION_CERTIFICATE", _count: { files: 1 } },
          { documentType: "HOME_INSURANCE", _count: { files: 1 } },
        ],
      },
    });
    const missing = assessProjectAttention(started, NOW).conditions.find(
      (c) => c.kind === "MISSING_DOCUMENT",
    );
    assert.equal(
      missing?.label,
      "Missing PCA inspector, HBCF insurance number",
    );
  });

  test("a required trade with no confirmed booking breaches the dependency only once the activity is under way", () => {
    const needsPlumber = { label: "Plumber" };
    const notYetDue = project({
      milestones: [milestone({ requiredTradeTypes: [needsPlumber] })],
    });
    assert.ok(!kinds(notYetDue).includes("DEPENDENCY"));

    const underWay = project({
      milestones: [
        milestone({
          status: "ACTIVE",
          startDate: NOW,
          requiredTradeTypes: [needsPlumber],
        }),
      ],
      tradieSchedules: [
        {
          milestoneId: "m1",
          status: "PENDING",
          trade: "Plumber",
          tradie: { trade: "Plumber" },
        },
      ],
    });
    assert.ok(kinds(underWay).includes("DEPENDENCY"));

    const confirmed = project({
      ...underWay,
      tradieSchedules: [
        {
          milestoneId: "m1",
          status: "CONFIRMED",
          trade: "Plumber",
          tradie: { trade: "Plumber" },
        },
      ],
    });
    assert.ok(!kinds(confirmed).includes("DEPENDENCY"));
  });

  test("most overdue first", () => {
    const a = assessProjectAttention(
      project({
        id: "a",
        name: "A",
        milestones: [
          milestone({ targetDate: new Date("2026-11-05T13:00:00Z") }),
        ],
      }),
      NOW,
    );
    const b = assessProjectAttention(
      project({
        id: "b",
        name: "B",
        milestones: [
          milestone({ targetDate: new Date("2026-10-20T13:00:00Z") }),
        ],
      }),
      NOW,
    );
    assert.deepEqual(
      needingAttention([a, b]).map((p) => p.projectId),
      ["b", "a"],
    );
  });
});
