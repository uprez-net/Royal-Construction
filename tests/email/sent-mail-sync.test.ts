import assert from "node:assert/strict";

import { CertifierEmailDirection, GraphMailbox } from "@prisma/client";
import { test } from "vitest";

import {
  recordSentMessage,
  SAME_SEND_WINDOW_MS,
  type SentMessageInput,
} from "@/lib/domain/email/sent-mail-sync";
import { DomainAuthorizationError } from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";

import { recordingDb } from "../architecture/domain-harness";

// The daily sync copies mail typed in Outlook onto the trail of whoever it
// went to. Every run overlaps the last, so the rule has to recognise what it
// already filed, and what the app recorded itself, without writing it twice.

const SYSTEM = systemPrincipal("cron:sent-mail-sync");
const SENT_AT = new Date("2026-10-28T03:15:00.000Z");
const TOKEN = "RCCERT-0123456789AB";

function message(overrides: Partial<SentMessageInput> = {}): SentMessageInput {
  return {
    graphMessageId: "AAMk-sent-1",
    mailbox: GraphMailbox.BUSINESS,
    from: "info@royalconstructions.com.au",
    subject: `RE: [${TOKEN}] 14 Example Street, Marrickville`,
    body: "Plans attached as discussed.",
    recipients: ["Certifier@Certifiers.com.au"],
    sentAt: SENT_AT,
    sentByApp: false,
    hasAttachments: false,
    ...overrides,
  };
}

const engagement = {
  id: "eng-1",
  projectId: "proj-1",
  certifierEmail: "certifier@certifiers.com.au",
};

test("mail the app sent itself is left alone", async () => {
  const recorder = recordingDb();
  const outcome = await recordSentMessage(
    SYSTEM,
    message({ sentByApp: true }),
    recorder.db,
  );
  assert.deepEqual(outcome, { status: "sent-by-app" });
  assert.deepEqual(recorder.calls, []);
});

test("mail only to our own mailboxes files nowhere", async () => {
  const recorder = recordingDb();
  const outcome = await recordSentMessage(
    SYSTEM,
    message({ recipients: ["info@royalconstructions.com.au"] }),
    recorder.db,
  );
  assert.deepEqual(outcome, { status: "unmatched" });
  assert.deepEqual(recorder.calls, []);
});

test("a reply on a certifier thread is filed outbound with its attachments", async () => {
  const stored: string[] = [];
  const recorder = recordingDb({
    "certifierEmail.findFirst": null,
    "certifierEngagement.findFirst": engagement,
  });
  const outcome = await recordSentMessage(
    SYSTEM,
    message({ hasAttachments: true }),
    recorder.db,
    {
      storeAttachments: async (projectId) => {
        stored.push(projectId);
        return [{ name: "plans.pdf", url: "https://blob/plans.pdf" }];
      },
    },
  );

  assert.equal(outcome.status, "filed");
  assert.deepEqual(stored, ["proj-1"]);
  const [write] = recorder.writes();
  assert.equal(write.operation, "certifierEmail.createMany");
  const [row] = (write.args as { data: Record<string, unknown>[] }).data;
  assert.equal(row.direction, CertifierEmailDirection.OUTBOUND);
  assert.equal(row.engagementId, "eng-1");
  assert.equal(row.outreachId, null);
  assert.equal(row.emailTo, "certifier@certifiers.com.au");
  assert.equal(row.emailFrom, "info@royalconstructions.com.au");
  assert.equal(row.sentAt, SENT_AT);
  assert.deepEqual(row.attachments, [
    { name: "plans.pdf", url: "https://blob/plans.pdf" },
  ]);
});

test("a certifier message already on the thread is not written or re-stored", async () => {
  let stored = 0;
  const recorder = recordingDb({
    "certifierEmail.findFirst": (args: unknown) => {
      const { where } = args as {
        where: { sentAt: { gte: Date; lte: Date } };
      };
      assert.equal(
        where.sentAt.lte.getTime() - where.sentAt.gte.getTime(),
        2 * SAME_SEND_WINDOW_MS,
      );
      return { id: "existing" };
    },
    "certifierEngagement.findFirst": engagement,
  });
  const outcome = await recordSentMessage(
    SYSTEM,
    message({ hasAttachments: true }),
    recorder.db,
    {
      storeAttachments: async () => {
        stored += 1;
        return [];
      },
    },
  );

  assert.equal(outcome.status, "filed");
  assert.equal(
    outcome.status === "filed" && outcome.filings[0].outcome,
    "already-recorded",
  );
  assert.equal(stored, 0);
  assert.deepEqual(recorder.writes(), []);
});

test("an address match on two jobs files against neither", async () => {
  const recorder = recordingDb({
    "certifierEngagement.findMany": [
      { ...engagement, subjectAddress: "14 Example Street, Marrickville" },
      {
        ...engagement,
        id: "eng-2",
        projectId: "proj-2",
        subjectAddress: "14 Example Street, Marrickville",
      },
    ],
    "complianceOutreach.findMany": [],
    "lead.findMany": [],
    "tradie.findMany": [],
  });
  const outcome = await recordSentMessage(
    SYSTEM,
    message({ subject: "14 Example Street, Marrickville - question" }),
    recorder.db,
  );
  assert.deepEqual(outcome, { status: "unmatched" });
  assert.deepEqual(recorder.writes(), []);
});

test("mail to a tradie lands on their activity log at the time it was sent", async () => {
  const recorder = recordingDb({
    "complianceOutreach.findMany": [],
    "certifierEngagement.findMany": [],
    "tradie.findMany": [
      { id: "tradie-1", email: "sparky@example.com", additionalEmails: [] },
    ],
    "tradieActivityLog.findFirst": null,
  });
  const outcome = await recordSentMessage(
    SYSTEM,
    message({ recipients: ["Sparky@Example.com"], subject: "Tuesday start" }),
    recorder.db,
  );

  assert.equal(outcome.status, "filed");
  const [write] = recorder.writes();
  assert.equal(write.operation, "tradieActivityLog.create");
  const { data } = write.args as { data: Record<string, unknown> };
  assert.equal(data.type, "outlookEmailSent");
  assert.equal(data.tradieId, "tradie-1");
  assert.equal(data.createdAt, SENT_AT);
  assert.equal(data.message, 'Emailed from Outlook: "Tuesday start"');
});

test("a tradie email already logged is not logged again", async () => {
  const recorder = recordingDb({
    "complianceOutreach.findMany": [],
    "certifierEngagement.findMany": [],
    "tradie.findMany": [
      { id: "tradie-1", email: "sparky@example.com", additionalEmails: [] },
    ],
    "tradieActivityLog.findFirst": { id: "logged" },
  });
  await recordSentMessage(
    SYSTEM,
    message({ recipients: ["sparky@example.com"], subject: "Tuesday start" }),
    recorder.db,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a certifier reply copied to the client is filed on both trails", async () => {
  const recorder = recordingDb({
    "certifierEmail.findFirst": null,
    "certifierEngagement.findFirst": engagement,
    "lead.findMany": [{ id: 42, email: "Client@Gmail.com" }],
    "leadEmails.findFirst": null,
    "tradie.findMany": [],
  });
  const outcome = await recordSentMessage(
    SYSTEM,
    message({
      recipients: ["certifier@certifiers.com.au", "client@gmail.com"],
    }),
    recorder.db,
  );

  assert.equal(outcome.status, "filed");
  assert.deepEqual(
    recorder.writes().map((write) => write.operation),
    ["certifierEmail.createMany", "leadEmails.createMany"],
  );
  const [, leadWrite] = recorder.writes();
  const [row] = (leadWrite.args as { data: Record<string, unknown>[] }).data;
  assert.equal(row.leadId, 42);
  assert.equal(row.emailTo, "client@gmail.com");
  assert.equal(row.sentAt, SENT_AT);
});

test("a lead email the app already recorded is not copied", async () => {
  const recorder = recordingDb({
    "complianceOutreach.findMany": [],
    "certifierEngagement.findMany": [],
    "lead.findMany": [{ id: 42, email: "client@gmail.com" }],
    "leadEmails.findFirst": { id: "sent-by-the-composer" },
    "tradie.findMany": [],
  });
  const outcome = await recordSentMessage(
    SYSTEM,
    message({ recipients: ["client@gmail.com"], subject: "Your quote" }),
    recorder.db,
  );
  assert.equal(
    outcome.status === "filed" && outcome.filings[0].outcome,
    "already-recorded",
  );
  assert.deepEqual(recorder.writes(), []);
});

test("nobody outside the office can file mail", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    recordSentMessage(
      { kind: "anonymous", source: "public" },
      message(),
      recorder.db,
    ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.calls, []);
});
