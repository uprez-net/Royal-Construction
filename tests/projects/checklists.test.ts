import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
  DomainStaleVersionError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import type { ChecklistDocumentData } from "@/lib/domain/ports/checklist";
import { exportChecklistDocument } from "@/lib/domain/projects/checklist-export";
import {
  changeChecklistIssueStatus,
  raiseChecklistIssue,
  sendChecklistIssueEmail,
  verifyChecklistIssue,
} from "@/lib/domain/projects/checklist-issues";
import {
  canMoveIssue,
  checklistDisplayStatus,
  checklistProgress,
  closureBlockers,
  defaultIssueEmail,
  isValidSignatureDataUrl,
  rankTradiesForWork,
} from "@/lib/domain/projects/checklist-rules";
import {
  CHECKLIST_STAGES,
  HANDOVER_TEMPLATE_KEY,
  checklistDefinition,
  checklistNumberForStage,
  templateItems,
  tradesForItem,
} from "@/lib/domain/projects/checklist-templates";
import {
  closeChecklist,
  ensureProjectChecklists,
  removeChecklistPhoto,
  setChecklistItemState,
} from "@/lib/domain/projects/checklists";
import { buildChecklistDocumentHtml } from "@/lib/projects/checklist-document-html";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

// Project checklists (issue #420). What is pinned here is what the client
// sees or relies on: the handover inventory exactly as their document has it,
// that a checklist cannot close past an unreviewed row or an unverified
// defect, that a tradie is never reported as emailed when they were not, and
// that a draft download can never pass for a final one.

const SIGNATURE = `data:image/png;base64,${"iVBORw0KGgo".repeat(10)}AAAA`;

const project = {
  id: "p_1",
  location: "12 Smith St, Parramatta NSW",
  name: "Smith Residence",
  siteManagerId: null,
};

const openChecklist = {
  id: "c_6",
  number: 6,
  projectId: "p_1",
  status: "OPEN",
  templateKey: HANDOVER_TEMPLATE_KEY,
  title: "Handover Checklist",
  version: 7,
};

const base = {
  "project.findUnique": project,
  "projectChecklist.findFirst": openChecklist,
  "user.findUnique": { name: "Gurpinder" },
};

const outbox = {
  "outboxEvent.findUnique": (args: unknown) => ({
    attempts: 0,
    id: "ob_1",
    key: (args as { where: { key: string } }).where.key,
    kind: "CHECKLIST_ISSUE_EMAIL_SEND",
    payload: {},
    status: "PENDING",
  }),
  "outboxEvent.upsert": (args: unknown) => ({
    id: "ob_1",
    key: (args as { where: { key: string } }).where.key,
    result: null,
    status: "PENDING",
  }),
};

describe("the handover template", () => {
  const items = templateItems(HANDOVER_TEMPLATE_KEY);

  test("has every row of the client's document: 95 rows in 17 rooms", () => {
    assert.equal(items.length, 95);
    const sections = [...new Set(items.map((item) => item.section))];
    assert.deepEqual(sections, [
      "Entry",
      "Hallway",
      "Lounge",
      "Dining",
      "Family",
      "Kitchen",
      "Main bed",
      "Bathrooms, en-suites, and toilets",
      "Bed 2",
      "Bed 3",
      "Bed 4",
      "Bed 5/Study",
      "Other Rooms",
      "Patio/verandah",
      "Garden shed or storage",
      "External house",
      "Other",
    ]);
    const count = (section: string) =>
      items.filter((item) => item.section === section).length;
    assert.equal(count("Kitchen"), 7);
    assert.equal(count("Bathrooms, en-suites, and toilets"), 7);
    assert.equal(count("Patio/verandah"), 4);
    assert.equal(count("Other"), 1);
  });

  test("keeps the source wording, and every row has a stable unique key", () => {
    const labels = items.map((item) => item.label);
    assert.ok(labels.includes("Front screen door"));
    assert.ok(
      labels.includes(
        "All appliances, including stove/cooktop/oven, rangehood, dishwasher, insinkerator, etc",
      ),
    );
    assert.ok(labels.includes("Light fittings, GPO’s, exhaust fans"));
    assert.ok(
      labels.includes(
        "Eves, gutters on lowset residences, downpipes and stormwater drain",
      ),
    );
    const keys = new Set(items.map((item) => item.key));
    assert.equal(keys.size, items.length);
    assert.deepEqual(
      items.map((item) => item.order),
      items.map((_, index) => index),
    );
  });

  test("names the likely trades, and none for the bins", () => {
    assert.ok(
      tradesForItem(
        HANDOVER_TEMPLATE_KEY,
        "kitchen.sink-plugs-and-plugholes",
      ).includes("Plumbing"),
    );
    assert.deepEqual(tradesForItem(HANDOVER_TEMPLATE_KEY, "other.bins"), []);
  });
});

describe("the six stage checklists", () => {
  test("checklist N verifies stage N, and only the sixth has rows", () => {
    assert.equal(CHECKLIST_STAGES.length, 6);
    for (let number = 1; number <= 5; number += 1) {
      const definition = checklistDefinition(number);
      assert.equal(templateItems(definition.templateKey).length, 0);
      assert.equal(checklistNumberForStage(definition.stage), number);
    }
    const handover = checklistDefinition(6);
    assert.equal(handover.stage, "Final");
    assert.equal(handover.title, "Handover Checklist");
    assert.equal(checklistNumberForStage("Final"), 6);
    assert.throws(() => checklistDefinition(7), RangeError);
  });

  test("creates the six and copies the handover rows, without duplicates", async () => {
    let created = false;
    const recorder = recordingDb({
      "projectChecklist.findMany": () =>
        created
          ? Array.from({ length: 6 }, (_, index) => ({
              _count: { items: 0 },
              id: `c_${index + 1}`,
              number: index + 1,
              templateKey: checklistDefinition(index + 1).templateKey,
            }))
          : [],
      "projectChecklist.createMany": () => {
        created = true;
        return { count: 6 };
      },
    });
    await ensureProjectChecklists("p_1", recorder.db);
    const writes = recorder.writes();
    assert.deepEqual(
      writes.map((write) => write.operation),
      ["projectChecklist.createMany", "checklistItem.createMany"],
    );
    const checklists = writes[0].args as {
      data: { number: number }[];
      skipDuplicates: boolean;
    };
    assert.equal(checklists.data.length, 6);
    assert.equal(checklists.skipDuplicates, true);
    const rows = writes[1].args as {
      data: { checklistId: string }[];
      skipDuplicates: boolean;
    };
    assert.equal(rows.data.length, 95);
    assert.ok(rows.data.every((row) => row.checklistId === "c_6"));
    assert.equal(rows.skipDuplicates, true);
  });
});

describe("the issue lifecycle", () => {
  test("verified is reached only from resolved, and a reopen goes back to open", () => {
    assert.equal(canMoveIssue("OPEN", "VERIFIED"), false);
    assert.equal(canMoveIssue("IN_PROGRESS", "VERIFIED"), false);
    assert.equal(canMoveIssue("RESOLVED", "VERIFIED"), true);
    assert.equal(canMoveIssue("VERIFIED", "OPEN"), true);
    assert.equal(canMoveIssue("VERIFIED", "RESOLVED"), false);
  });

  test("an issue cannot be moved to verified without a signature", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findFirst": {
        checklistId: "c_6",
        id: "i_1",
        status: "RESOLVED",
      },
    });
    await assert.rejects(
      () =>
        changeChecklistIssueStatus(
          adminPrincipal(),
          { issueId: "i_1", projectId: "p_1", to: "VERIFIED" },
          recorder.db,
        ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("an open issue cannot be verified, even with a signature", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findFirst": {
        checklistId: "c_6",
        id: "i_1",
        status: "OPEN",
      },
    });
    await assert.rejects(
      () =>
        verifyChecklistIssue(
          adminPrincipal(),
          {
            issueId: "i_1",
            projectId: "p_1",
            reviewerName: "Gurpinder",
            signatureDataUrl: SIGNATURE,
          },
          recorder.transactionalDb,
        ),
      DomainTransitionError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("reopening a verified issue needs a reason and clears the sign-off", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findFirst": {
        checklistId: "c_6",
        id: "i_1",
        resolvedAt: null,
        status: "VERIFIED",
      },
    });
    await assert.rejects(
      () =>
        changeChecklistIssueStatus(
          adminPrincipal(),
          { issueId: "i_1", projectId: "p_1", to: "OPEN" },
          recorder.db,
        ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);

    await changeChecklistIssueStatus(
      adminPrincipal(),
      {
        issueId: "i_1",
        note: "Paint flaking again",
        projectId: "p_1",
        to: "OPEN",
      },
      recorder.db,
    );
    const update = recorder.writes()[0];
    assert.equal(update.operation, "checklistIssue.updateMany");
    const args = update.args as {
      data: { status: string; verifiedAt: null };
      where: { status: string };
    };
    assert.equal(args.data.status, "OPEN");
    assert.equal(args.data.verifiedAt, null);
    assert.equal(args.where.status, "VERIFIED");
  });
});

describe("closing a checklist", () => {
  const items = [
    { id: "it_1", state: "CHECKED" },
    { id: "it_2", state: "NOT_APPLICABLE" },
  ];

  const close = (
    recorder: ReturnType<typeof recordingDb>,
    overrides: Partial<Parameters<typeof closeChecklist>[1]> = {},
    principal = adminPrincipal(),
  ) =>
    closeChecklist(
      principal,
      {
        checklistId: "c_6",
        expectedVersion: 7,
        projectId: "p_1",
        reviewerName: "Gurpinder",
        signatureDataUrl: SIGNATURE,
        ...overrides,
      },
      recorder.transactionalDb,
    );

  test("is refused while a row is unreviewed, and writes nothing", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findMany": [],
      "checklistItem.findMany": [...items, { id: "it_3", state: "UNCHECKED" }],
    });
    await assert.rejects(
      () => close(recorder),
      /1 inspection item has not been reviewed/,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("is refused while an issue is resolved but not verified", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findMany": [
        { id: "i_1", itemId: "it_1", status: "RESOLVED" },
      ],
      "checklistItem.findMany": items,
    });
    await assert.rejects(() => close(recorder), /needs your verification/);
    assert.deepEqual(recorder.writes(), []);
  });

  test("is refused when the page is out of date", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findMany": [],
      "checklistItem.findMany": items,
    });
    await assert.rejects(
      () => close(recorder, { expectedVersion: 6 }),
      DomainStaleVersionError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("needs a reviewer name and a signature", async () => {
    const recorder = recordingDb(base);
    await assert.rejects(
      () => close(recorder, { reviewerName: " " }),
      DomainValidationError,
    );
    await assert.rejects(
      () => close(recorder, { signatureDataUrl: "data:image/png;base64,x" }),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("is refused to a customer", async () => {
    const recorder = recordingDb(base);
    await assert.rejects(
      () => close(recorder, {}, customerPrincipal()),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("closes, records the signature and the history once every issue is verified", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findMany": [
        { id: "i_1", itemId: "it_1", status: "VERIFIED" },
      ],
      "checklistItem.findMany": items,
    });
    const result = await close(recorder);
    assert.equal(result.version, 8);
    assert.deepEqual(
      recorder.writes().map((write) => write.operation),
      [
        "projectChecklist.updateMany",
        "checklistSignature.create",
        "activityLog.create",
      ],
    );
    const update = recorder.writes()[0].args as {
      data: { status: string };
      where: { status: string; version: number };
    };
    assert.equal(update.data.status, "CLOSED");
    assert.deepEqual(update.where, { id: "c_6", status: "OPEN", version: 7 });
    const signature = recorder.writes()[1].args as {
      data: { purpose: string; reviewerName: string };
    };
    assert.equal(signature.data.purpose, "CHECKLIST_CLOSURE");
    assert.equal(signature.data.reviewerName, "Gurpinder");
  });

  test("a closed checklist refuses edits until it is reopened", async () => {
    const recorder = recordingDb({
      ...base,
      "projectChecklist.findFirst": { ...openChecklist, status: "CLOSED" },
    });
    await assert.rejects(
      () =>
        setChecklistItemState(
          adminPrincipal(),
          {
            checklistId: "c_6",
            itemId: "it_1",
            projectId: "p_1",
            state: "UNCHECKED",
          },
          recorder.db,
        ),
      DomainTransitionError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("the closure rule agrees with what the screen shows", () => {
    const blockers = closureBlockers({
      issues: [
        { id: "a", itemId: "x", status: "OPEN" },
        { id: "b", itemId: "x", status: "RESOLVED" },
      ],
      items: [{ id: "x", state: "CHECKED" }],
      status: "OPEN",
    });
    assert.equal(blockers.canClose, false);
    assert.equal(blockers.unresolved.length, 1);
    assert.equal(blockers.awaitingVerification.length, 1);

    const empty = closureBlockers({ issues: [], items: [], status: "OPEN" });
    assert.equal(empty.canClose, false);
    assert.equal(empty.notConfigured, true);
  });
});

describe("reviewing rows", () => {
  test("not applicable needs a reason, and is refused on a row with an open issue", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistItem.findFirst": {
        id: "it_1",
        issues: [{ status: "IN_PROGRESS" }],
      },
    });
    const input = {
      checklistId: "c_6",
      itemId: "it_1",
      projectId: "p_1",
      state: "NOT_APPLICABLE" as const,
    };
    await assert.rejects(
      () => setChecklistItemState(adminPrincipal(), input, recorder.db),
      /Say why/,
    );
    await assert.rejects(
      () =>
        setChecklistItemState(
          adminPrincipal(),
          { ...input, naReason: "No study in this design" },
          recorder.db,
        ),
      /open issue/,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a photo that is evidence for an issue cannot be removed", async () => {
    let deleted = false;
    const recorder = recordingDb({
      ...base,
      "checklistAttachment.findFirst": {
        file: { url: "https://blob/x.jpg" },
        id: "a_1",
        issue: { number: 2 },
        issueId: "i_2",
      },
    });
    await assert.rejects(
      () =>
        removeChecklistPhoto(
          adminPrincipal(),
          { attachmentId: "a_1", checklistId: "c_6", projectId: "p_1" },
          recorder.db,
          async () => {
            deleted = true;
          },
        ),
      /evidence for issue #2/,
    );
    assert.equal(deleted, false);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a checklist from another project reads as absent", async () => {
    const recorder = recordingDb({
      ...base,
      "projectChecklist.findFirst": null,
    });
    await assert.rejects(
      () =>
        setChecklistItemState(
          adminPrincipal(),
          {
            checklistId: "c_other",
            itemId: "it_1",
            projectId: "p_1",
            state: "CHECKED",
          },
          recorder.db,
        ),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("raising an issue and telling the tradie", () => {
  test("a replayed request key returns the issue already raised", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findUnique": { checklistId: "c_6", id: "i_1", number: 1 },
    });
    const raised = await raiseChecklistIssue(
      adminPrincipal(),
      {
        checklistId: "c_6",
        description: "Benchtop chipped",
        itemId: "it_1",
        projectId: "p_1",
        requestKey: "k_1",
      },
      recorder.transactionalDb,
    );
    assert.equal(raised.replayed, true);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a description is required", async () => {
    const recorder = recordingDb(base);
    await assert.rejects(
      () =>
        raiseChecklistIssue(
          adminPrincipal(),
          {
            checklistId: "c_6",
            description: "  ",
            itemId: "it_1",
            projectId: "p_1",
            requestKey: "k_1",
          },
          recorder.transactionalDb,
        ),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  const issueRow = (tradie: { name: string; email: string } | null) => ({
    assignedTradie: tradie ? { id: "t_1", ...tradie } : null,
    checklistId: "c_6",
    id: "i_1",
    status: "OPEN",
  });

  test("an unassigned issue is never emailed", async () => {
    let sent = false;
    const recorder = recordingDb({
      ...base,
      "checklistIssue.findFirst": issueRow(null),
    });
    await assert.rejects(
      () =>
        sendChecklistIssueEmail(
          adminPrincipal(),
          {
            attemptKey: "a_1",
            body: "Fix it",
            issueId: "i_1",
            projectId: "p_1",
            subject: "Rectification",
          },
          recorder.db,
          async () => {
            sent = true;
          },
        ),
      DomainValidationError,
    );
    assert.equal(sent, false);
    assert.deepEqual(recorder.writes(), []);
  });

  test("a failed send is written on the issue and refused, never reported as sent", async () => {
    const recorder = recordingDb({
      ...base,
      ...outbox,
      "checklistAttachment.findMany": [
        {
          file: {
            fileType: "image/jpeg",
            filename: "chip.jpg",
            url: "https://blob/chip.jpg",
          },
        },
      ],
      "checklistIssue.findFirst": issueRow({
        email: "bob@tiles.example",
        name: "Bob Tiler",
      }),
    });
    await assert.rejects(
      () =>
        sendChecklistIssueEmail(
          adminPrincipal(),
          {
            attemptKey: "a_1",
            body: "Fix it",
            issueId: "i_1",
            projectId: "p_1",
            subject: "Rectification",
          },
          recorder.db,
          async () => {
            throw new Error("Graph is down");
          },
        ),
      DomainSideEffectError,
    );
    const issueUpdates = recorder
      .writes()
      .filter((write) => write.operation === "checklistIssue.update")
      .map((write) => (write.args as { data: Record<string, unknown> }).data);
    assert.ok(
      issueUpdates.some((data) => data.notificationStatus === "FAILED"),
    );
    assert.ok(issueUpdates.every((data) => data.notificationStatus !== "SENT"));
    const events = recorder
      .writes()
      .filter((write) => write.operation === "checklistIssueEvent.create")
      .map((write) => (write.args as { data: { kind: string } }).data.kind);
    assert.deepEqual(events, ["EMAIL_FAILED"]);
  });

  test("a sent email carries the photos and marks the issue sent", async () => {
    const delivered: unknown[] = [];
    const recorder = recordingDb({
      ...base,
      ...outbox,
      "checklistAttachment.findMany": [
        {
          file: {
            fileType: "image/jpeg",
            filename: "chip.jpg",
            url: "https://blob/chip.jpg",
          },
        },
      ],
      "checklistIssue.findFirst": issueRow({
        email: "bob@tiles.example",
        name: "Bob Tiler",
      }),
    });
    const sent = await sendChecklistIssueEmail(
      siteManagerPrincipal(),
      {
        attemptKey: "a_1",
        body: "Fix it",
        issueId: "i_1",
        projectId: "p_1",
        subject: "Rectification",
      },
      recorder.db,
      async (input) => {
        delivered.push(input);
      },
    ).catch((error: unknown) => error);
    // A site manager not assigned to this project is refused before sending.
    assert.ok(sent instanceof DomainAuthorizationError);
    assert.equal(delivered.length, 0);

    const ok = await sendChecklistIssueEmail(
      adminPrincipal(),
      {
        attemptKey: "a_1",
        body: "Fix it",
        issueId: "i_1",
        projectId: "p_1",
        subject: "Rectification",
      },
      recorder.db,
      async (input) => {
        delivered.push(input);
      },
    );
    assert.equal(ok.to, "bob@tiles.example");
    assert.equal(ok.replayed, false);
    assert.equal(delivered.length, 1);
    assert.equal((delivered[0] as { photos: unknown[] }).photos.length, 1);
    const issueUpdates = recorder
      .writes()
      .filter((write) => write.operation === "checklistIssue.update")
      .map((write) => (write.args as { data: Record<string, unknown> }).data);
    assert.ok(issueUpdates.some((data) => data.notificationStatus === "SENT"));
  });

  test("the suggested email names the address, the room and the row", () => {
    const email = defaultIssueEmail({
      checklistTitle: "Handover Checklist",
      description: "Chip on the front edge",
      itemLabel: "Cupboards, benchtops",
      photoCount: 3,
      projectName: "Smith Residence",
      section: "Kitchen",
      siteAddress: "12 Smith St",
      tradieName: "Bob Tiler",
    });
    assert.match(email.subject, /Rectification required – Smith Residence/);
    assert.match(email.body, /^Hi Bob,/);
    assert.match(email.body, /handover inspection at 12 Smith St/);
    assert.match(email.body, /Kitchen – Cupboards, benchtops/);
    assert.match(email.body, /attached photographs/);
  });

  test("the tradies who did the work come first; nobody is dropped", () => {
    const ranked = rankTradiesForWork(
      [
        { id: "a", trades: ["Electrician"] },
        { id: "b", trades: ["plumbing"] },
      ],
      ["Plumbing"],
    );
    assert.deepEqual(
      ranked.matching.map((t) => t.id),
      ["b"],
    );
    assert.deepEqual(
      ranked.others.map((t) => t.id),
      ["a"],
    );
  });
});

describe("the downloaded checklist", () => {
  const exportRow = (status: "OPEN" | "CLOSED") => ({
    closedAt: status === "CLOSED" ? new Date("2026-11-10T00:00:00Z") : null,
    comments: "Touch-ups done",
    checkedBy: "Gurpinder",
    issues: [],
    items: [
      {
        id: "it_1",
        label: "Front screen door",
        naReason: null,
        section: "Entry",
        state: "CHECKED",
      },
    ],
    number: 6,
    project: {
      buildingType: "Double Storey",
      location: "12 Smith St",
      name: "Smith Residence",
    },
    stage: "Final",
    status,
    title: "Handover Checklist",
    version: 9,
  });

  const run = async (status: "OPEN" | "CLOSED") => {
    let printed: ChecklistDocumentData | null = null;
    const recorder = recordingDb({
      ...base,
      "projectChecklist.findFirst": { ...openChecklist, status },
      "projectChecklist.findFirstOrThrow": exportRow(status),
      "checklistSignature.create": { id: "s_1" },
      "checklistExport.create": { id: "e_1" },
    });
    const exported = await exportChecklistDocument(
      adminPrincipal(),
      {
        checklistId: "c_6",
        projectId: "p_1",
        reviewerName: "Gurpinder",
        signatureDataUrl: SIGNATURE,
      },
      recorder.db,
      async (document) => {
        printed = document;
        return new Uint8Array([1]);
      },
    );
    return {
      exported,
      printed: printed as unknown as ChecklistDocumentData,
      recorder,
    };
  };

  test("an open checklist downloads as a draft, and downloading does not close it", async () => {
    const { exported, printed, recorder } = await run("OPEN");
    assert.equal(exported.final, false);
    assert.match(exported.filename, /-DRAFT\.pdf$/);
    assert.equal(printed.final, false);
    assert.ok(
      recorder
        .writes()
        .every((write) => !write.operation.startsWith("projectChecklist.")),
    );
    const html = buildChecklistDocumentHtml(printed);
    assert.match(html, /Draft – inspection in progress, not closed/);
    assert.match(html, /DRAFT<\/div>/);
    assert.doesNotMatch(html, /Final – closed/);
  });

  test("a closed checklist downloads as final, with the header fields and the signature", async () => {
    const { exported, printed } = await run("CLOSED");
    assert.equal(exported.final, true);
    assert.doesNotMatch(exported.filename, /DRAFT/);
    const html = buildChecklistDocumentHtml(printed);
    assert.match(html, /Final – closed/);
    assert.match(html, /Project Address:<\/td><td>12 Smith St/);
    assert.match(html, /House Type:<\/td><td>Double Storey/);
    assert.match(html, /Name of the Reviewer<\/span>Gurpinder/);
    assert.ok(html.includes(SIGNATURE));
    assert.doesNotMatch(html, /class="watermark"/);
  });

  test("an empty checklist prints as a blank template, never as inspected", () => {
    const html = buildChecklistDocumentHtml({
      checkedBy: null,
      checklistNumber: 2,
      checklistTitle: "Slab Checklist",
      closedAt: null,
      comments: null,
      configured: false,
      final: false,
      houseType: "Single Storey",
      issues: [],
      projectAddress: "1 Test Rd",
      projectName: "Test",
      reviewerName: "Gurpinder",
      sections: [],
      signatureDataUrl: SIGNATURE,
      signedAt: new Date("2026-11-12T00:00:00Z"),
      stageLabel: "Slab",
      version: 1,
    });
    assert.match(html, /Blank template – not configured/);
    assert.match(html, /records nothing as inspected or completed/);
  });
});

describe("progress and signatures", () => {
  test("counts reviewed rows and blocking issues", () => {
    const progress = checklistProgress(
      [
        { id: "a", state: "CHECKED" },
        { id: "b", state: "NOT_APPLICABLE" },
        { id: "c", state: "UNCHECKED" },
      ],
      [
        { id: "i", itemId: "a", status: "RESOLVED" },
        { id: "j", itemId: "a", status: "VERIFIED" },
      ],
    );
    assert.equal(progress.reviewed, 2);
    assert.equal(progress.openIssues, 1);
    assert.equal(progress.awaitingVerification, 1);
    assert.equal(checklistDisplayStatus("OPEN", progress), "in_progress");
    assert.equal(
      checklistDisplayStatus("OPEN", checklistProgress([], [])),
      "not_configured",
    );
  });

  test("only a PNG data URL of sensible size is a signature", () => {
    assert.equal(isValidSignatureDataUrl(SIGNATURE), true);
    assert.equal(
      isValidSignatureDataUrl("data:image/svg+xml;base64,AAAA"),
      false,
    );
    assert.equal(isValidSignatureDataUrl("https://example.com/sig.png"), false);
    assert.equal(
      isValidSignatureDataUrl(`data:image/png;base64,${"A".repeat(300_000)}`),
      false,
    );
  });
});
