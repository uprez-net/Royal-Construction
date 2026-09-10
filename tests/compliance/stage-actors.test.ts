import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ComplianceApprovalDecision,
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  ComplianceExternalApplicationKind,
  ComplianceOutreachMode,
  ComplianceOutreachStatus,
  CompliancePartyType,
} from "@prisma/client";

import { PARTY_LABEL } from "../../constants/complianceDocuments";
import {
  complianceStageFlow,
  type ComplianceStageId,
} from "../../lib/compliance/stage-flow";
import type { CertifierEngagementDetail } from "../../types/compliance";

/**
 * Who each node says is behind it.
 *
 * The failures worth guarding here are all of one kind and none of them throw:
 * a node drawing a firm that is not in the job, or missing one that is, or
 * calling a firm outstanding when nobody has written to them. Every one of
 * those is a picture that is confidently wrong, which is worse than an empty
 * node — a reader who is shown a structural engineer goes looking for one.
 */

const sydney = (value: string) => new Date(`${value}+10:00`);
const MONDAY = sydney("2026-06-01T09:00:00");

function engagement(
  overrides: Partial<CertifierEngagementDetail> = {},
): CertifierEngagementDetail {
  return {
    id: "engagement-1",
    projectId: "project-1",
    status: "COLLECTING_DOCS",
    documents: [],
    outreaches: [],
    alerts: [],
    emails: [],
    externalApplications: [],
    ...overrides,
  } as unknown as CertifierEngagementDetail;
}

function outreach(
  party: CompliancePartyType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `outreach-${party}`,
    party,
    mode: ComplianceOutreachMode.OUTREACH,
    status: ComplianceOutreachStatus.SENT,
    sentAt: MONDAY,
    contactEmail: "firm@example.com",
    contactName: "A Firm",
    checklistDocumentId: null,
    approvalDecision: null,
    wasteManagementRequestedAt: null,
    emails: [],
    meetings: [],
    revisions: [],
    deliverables: [],
    ...overrides,
  };
}

function document(
  documentType: ComplianceDocumentType,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `document-${documentType}-${String(overrides.id ?? "1")}`,
    documentType,
    status: ComplianceDocumentStatus.UPLOADED,
    files: [{ id: "file-1", url: "https://blob/one.pdf" }],
    createdAt: MONDAY,
    detail: null,
    label: null,
    order: 0,
    ...overrides,
  };
}

/** A checklist line the extraction labelled as asking for one document type. */
function checklistLine(
  id: string,
  mapsToType: ComplianceDocumentType | null,
  overrides: Record<string, unknown> = {},
) {
  return document(ComplianceDocumentType.CHECKLIST_ITEM, {
    id,
    files: [],
    // The stored blob, not a string of it — `checklistItemDetail` reads the
    // Prisma Json column, which arrives already parsed.
    detail: mapsToType ? { version: 1, mapsToType } : null,
    ...overrides,
  });
}

const actorsOn = (detail: CertifierEngagementDetail, id: ComplianceStageId) => {
  const stage = complianceStageFlow(detail, MONDAY).find(
    (entry) => entry.id === id,
  );
  assert.ok(stage, `no ${id} stage`);
  return stage.actors;
};

const ids = (actors: { id: string }[]) => actors.map((actor) => actor.id);
const stateOf = (actors: { id: string; state: string }[], id: string) =>
  actors.find((actor) => actor.id === id)?.state;

// ---------------------------------------------------------------------------
// The parties nobody has written to
// ---------------------------------------------------------------------------

test("a party nobody has written to is idle, not outstanding", () => {
  // The badge that would otherwise appear on day one of every job: an amber
  // "Surveyor" on a file where nobody has been engaged and nothing is late.
  assert.equal(
    stateOf(actorsOn(engagement(), "SURVEYOR"), CompliancePartyType.SURVEYOR),
    "idle",
  );
});

test("a party the client supplied reads as settled", () => {
  const detail = engagement({
    outreaches: [
      outreach(CompliancePartyType.SURVEYOR, {
        mode: ComplianceOutreachMode.SELF_SUPPLIED,
      }),
    ] as never,
  });

  assert.equal(
    stateOf(actorsOn(detail, "SURVEYOR"), CompliancePartyType.SURVEYOR),
    "settled",
  );
});

test("an engaged surveyor who has sent nothing is outstanding", () => {
  const detail = engagement({
    outreaches: [outreach(CompliancePartyType.SURVEYOR)] as never,
  });

  assert.equal(
    stateOf(actorsOn(detail, "SURVEYOR"), CompliancePartyType.SURVEYOR),
    "outstanding",
  );
});

test("an architect with no meeting booked is not being waited on", () => {
  // The same reading the sweep takes. An architect who has not sat with the
  // owners has nothing to draw, so chasing them would be chasing them for work
  // they cannot have started.
  const detail = engagement({
    outreaches: [outreach(CompliancePartyType.ARCHITECT)] as never,
  });

  assert.equal(
    stateOf(actorsOn(detail, "ARCHITECT"), CompliancePartyType.ARCHITECT),
    "idle",
  );
});

// ---------------------------------------------------------------------------
// The development application's fixed cast
// ---------------------------------------------------------------------------

test("the approval branch draws its whole cast on a job that is not on it", () => {
  // The point of drawing a dormant branch at all: a reader can see what taking
  // it would pull in before anybody commits to it.
  const actors = actorsOn(engagement(), "DEVELOPMENT_APPLICATION");

  for (const expected of [
    "builder",
    "permits",
    CompliancePartyType.COUNCIL,
    CompliancePartyType.BASIX_CONSULTANT,
    CompliancePartyType.STRUCTURAL_ENGINEER,
    CompliancePartyType.ARCHITECT,
  ]) {
    assert.ok(ids(actors).includes(expected), `missing ${expected}`);
  }
});

test("the estate developer is only in the cast where there is one", () => {
  assert.ok(
    !ids(actorsOn(engagement(), "DEVELOPMENT_APPLICATION")).includes(
      CompliancePartyType.DEVELOPER,
    ),
  );

  const detail = engagement({
    outreaches: [
      outreach(CompliancePartyType.DEVELOPER, {
        approvalDecision: ComplianceApprovalDecision.APPROVED,
      }),
    ] as never,
  });

  assert.equal(
    stateOf(
      actorsOn(detail, "DEVELOPMENT_APPLICATION"),
      CompliancePartyType.DEVELOPER,
    ),
    "settled",
  );
});

test("the council settles when the application is determined", () => {
  const detail = engagement({
    externalApplications: [
      {
        id: "app-1",
        kind: ComplianceExternalApplicationKind.DEVELOPMENT_APPLICATION,
        alreadyHeld: false,
        appliedAt: MONDAY,
        applicationRef: null,
        lodgedWith: null,
        receivedAt: MONDAY,
        submissions: [],
      },
    ] as never,
  });

  assert.equal(
    stateOf(
      actorsOn(detail, "DEVELOPMENT_APPLICATION"),
      CompliancePartyType.COUNCIL,
    ),
    "settled",
  );
});

// ---------------------------------------------------------------------------
// The checklist, whose cast is whatever the certifier asked for
// ---------------------------------------------------------------------------

test("a checklist nobody has issued shows who it might pull in", () => {
  const actors = actorsOn(engagement(), "CHECKLIST");

  assert.ok(ids(actors).includes(CompliancePartyType.BASIX_CONSULTANT));
  assert.ok(actors.every((actor) => actor.state === "idle"));
});

test("an issued checklist shows only the parties its lines name", () => {
  const detail = engagement({
    documents: [
      checklistLine("a", ComplianceDocumentType.BASIX_CERTIFICATE),
      checklistLine("b", ComplianceDocumentType.STRUCTURAL_DRAWINGS),
      // An ordinary line the extraction could not label. Somebody on the job
      // finds or produces it, which is the builder as far as a node is
      // concerned.
      checklistLine("c", null),
    ] as never,
    outreaches: [outreach(CompliancePartyType.BASIX_CONSULTANT)] as never,
  });

  const actors = actorsOn(detail, "CHECKLIST");

  assert.deepEqual(ids(actors).sort(), [
    "builder",
    CompliancePartyType.BASIX_CONSULTANT,
    CompliancePartyType.STRUCTURAL_ENGINEER,
  ].sort());
  // Nobody has been written to about the structural drawings yet.
  assert.equal(
    stateOf(actors, CompliancePartyType.STRUCTURAL_ENGINEER),
    "idle",
  );
  assert.equal(
    stateOf(actors, CompliancePartyType.BASIX_CONSULTANT),
    "outstanding",
  );
  assert.equal(stateOf(actors, "builder"), "outstanding");
});

test("a line waved off settles the party it named", () => {
  const detail = engagement({
    documents: [
      checklistLine("a", ComplianceDocumentType.BASIX_CERTIFICATE, {
        status: ComplianceDocumentStatus.NOT_REQUIRED,
      }),
    ] as never,
    outreaches: [outreach(CompliancePartyType.BASIX_CONSULTANT)] as never,
  });

  assert.equal(
    stateOf(
      actorsOn(detail, "CHECKLIST"),
      CompliancePartyType.BASIX_CONSULTANT,
    ),
    "settled",
  );
});

test("a line asking for a bought permit is filed under the portals", () => {
  const detail = engagement({
    documents: [
      checklistLine("a", ComplianceDocumentType.LONG_SERVICE_LEVY),
    ] as never,
  });

  assert.deepEqual(ids(actorsOn(detail, "CHECKLIST")), ["permits"]);
});

// ---------------------------------------------------------------------------
// The names
// ---------------------------------------------------------------------------

test("every party's full name is the one the rest of the tab uses", () => {
  // The badge text is this module's own — "Water servicing coordinator" does
  // not fit under a node — but the name behind it has to be the one on the
  // section heading and the thread tab, or the badge's title sends somebody
  // looking for a firm under a name nothing else uses.
  const detail = engagement({
    outreaches: [
      outreach(CompliancePartyType.DEVELOPER, {
        approvalDecision: ComplianceApprovalDecision.APPROVED,
      }),
    ] as never,
  });

  const seen = [
    ...actorsOn(detail, "SURVEYOR"),
    ...actorsOn(detail, "ARCHITECT"),
    ...actorsOn(detail, "COUNCIL"),
    ...actorsOn(detail, "DEVELOPMENT_APPLICATION"),
    ...actorsOn(detail, "CHECKLIST"),
  ];

  for (const actor of seen) {
    if (!(actor.id in CompliancePartyType)) continue;
    assert.equal(
      actor.label,
      PARTY_LABEL[actor.id as CompliancePartyType],
      `${actor.id} is named two ways`,
    );
  }
});
