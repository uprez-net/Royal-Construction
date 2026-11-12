import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainStaleVersionError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { closeChecklist } from "@/lib/domain/projects/checklist-closure";
import {
  changeChecklistIssueStatus,
  verifyChecklistIssue,
} from "@/lib/domain/projects/checklist-issue-lifecycle";
import {
  removeChecklistPhoto,
  setChecklistItemState,
} from "@/lib/domain/projects/checklist-review";
import { closureBlockers } from "@/lib/domain/projects/checklist-rules";
import { getChecklistDetail } from "@/lib/domain/projects/checklists";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";
import { SIGNATURE, base, openChecklist } from "./checklist-fixtures";

// Project checklists (issue #420): that a checklist cannot close past an
// unreviewed row or an unverified defect, that nothing lands on a closed one,
// and that a refused command writes nothing.

describe("the issue lifecycle", () => {
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
    // The checklist's revision is bumped first, guarded on it being open.
    assert.equal(recorder.writes()[0].operation, "projectChecklist.updateMany");
    const update = recorder.writes()[1];
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

  test("a write racing a close in another tab is refused before it lands", async () => {
    const recorder = recordingDb({
      ...base,
      "checklistItem.findFirst": { id: "it_1", issues: [] },
      // The guarded bump finds the checklist no longer open.
      "projectChecklist.updateMany": { count: 0 },
    });
    await assert.rejects(
      () =>
        setChecklistItemState(
          adminPrincipal(),
          {
            checklistId: "c_6",
            itemId: "it_1",
            projectId: "p_1",
            state: "CHECKED",
          },
          recorder.db,
        ),
      /closed while you were working on it/,
    );
    assert.deepEqual(
      recorder.writes().map((write) => write.operation),
      ["projectChecklist.updateMany"],
    );
    const guard = recorder.writes()[0].args as { where: { status: string } };
    assert.equal(guard.where.status, "OPEN");
  });

  test("a customer cannot read a checklist, nor the tradie directory through it", async () => {
    const recorder = recordingDb(base);
    await assert.rejects(
      () =>
        getChecklistDetail(
          customerPrincipal(),
          { number: 6, projectId: "p_1" },
          recorder.db,
        ),
      DomainAuthorizationError,
    );
    assert.ok(!recorder.operations().includes("tradie.findMany"));
    assert.deepEqual(recorder.writes(), []);
  });
});
