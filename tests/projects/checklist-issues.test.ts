import assert from "node:assert/strict";

import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { sendChecklistIssueEmail } from "@/lib/domain/projects/checklist-issue-email";
import { raiseChecklistIssue } from "@/lib/domain/projects/checklist-issues";
import {
  defaultIssueEmail,
  rankTradiesForWork,
} from "@/lib/domain/projects/checklist-rules";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";
import { base, outbox } from "./checklist-fixtures";

// Checklist defects (issue #420): a tradie is never reported as emailed when
// they were not, and never reported as not emailed when they were.

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
      customerPrincipal(),
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
    // Someone outside the staff is refused before sending. (Any site manager
    // may record checklists on any project since 2026-11-20.)
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

  const send = (
    recorder: ReturnType<typeof recordingDb>,
    port: () => Promise<void>,
  ) =>
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
      port,
    );

  const notificationStates = (recorder: ReturnType<typeof recordingDb>) =>
    recorder
      .writes()
      .filter((write) => write.operation === "checklistIssue.update")
      .map(
        (write) =>
          (write.args as { data: { notificationStatus?: string } }).data
            .notificationStatus,
      )
      .filter(Boolean);

  test("an email that went is recorded as sent even if the outbox could not record it", async () => {
    let sent = 0;
    const recorder = recordingDb({
      ...base,
      ...outbox,
      "checklistAttachment.findMany": [],
      "checklistIssue.findFirst": issueRow({
        email: "bob@tiles.example",
        name: "Bob Tiler",
      }),
      // The claim succeeds; recording the outcome afterwards fails.
      "outboxEvent.updateMany": (args: unknown) => {
        if (
          (args as { data: { status: string } }).data.status === "SUCCEEDED"
        ) {
          throw new Error("database blip");
        }
        return { count: 1 };
      },
    });
    const result = await send(recorder, async () => {
      sent += 1;
    });
    assert.equal(sent, 1);
    assert.equal(result.to, "bob@tiles.example");
    assert.deepEqual(notificationStates(recorder), ["SENT"]);
  });

  test("an attempt the outbox refuses leaves the issue as it was", async () => {
    let sent = 0;
    const recorder = recordingDb({
      ...base,
      ...outbox,
      "checklistAttachment.findMany": [],
      "checklistIssue.findFirst": issueRow({
        email: "bob@tiles.example",
        name: "Bob Tiler",
      }),
      "outboxEvent.upsert": {
        id: "ob_1",
        key: "k",
        result: null,
        status: "RUNNING",
      },
    });
    await assert.rejects(
      () =>
        send(recorder, async () => {
          sent += 1;
        }),
      DomainTransitionError,
    );
    assert.equal(sent, 0);
    assert.deepEqual(notificationStates(recorder), []);
    assert.ok(
      !recorder
        .writes()
        .some((write) => write.operation === "checklistIssueEvent.create"),
    );
  });
});
