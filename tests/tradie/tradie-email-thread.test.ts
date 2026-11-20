import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import {
  DomainAuthorizationError,
  DomainSideEffectError,
  DomainTransitionError,
  DomainValidationError,
} from "@/lib/domain/errors";
import {
  getTradieProjectThread,
  recordInboundTradieEmail,
  replyOnTradieThread,
  stripReplyPrefixes,
  tradieReplyHtml,
} from "@/lib/domain/tradies/emails";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
} from "../architecture/domain-harness";
import { REPO_ROOT } from "../support/repo-root";

const PROJECT = {
  id: "p_1",
  location: "11 Wheat Street",
  name: "11 Wheat Street",
  siteManagerId: null,
};

const TRADIE = {
  additionalEmails: ["Accounts@abc.example"],
  archivedAt: null,
  email: "quotes@abc.example",
  id: "t_1",
  name: "ABC Plumbing",
};

/** An outbox that claims the attempt and lets it run, or replays it. */
function outbox(state: "fresh" | "succeeded") {
  return {
    "outboxEvent.upsert":
      state === "succeeded"
        ? { id: "e_1", key: "k", result: { to: "x" }, status: "SUCCEEDED" }
        : { id: "e_1", key: "k", result: null, status: "PENDING" },
    "outboxEvent.findUnique": {
      attempts: 0,
      id: "e_1",
      key: "k",
      kind: "TRADIE_THREAD_REPLY_SEND",
      payload: {},
      status: "PENDING",
    },
    "outboxEvent.updateMany": { count: 1 },
  };
}

function replyDb(
  overrides: Record<string, unknown> = {},
  state: "fresh" | "succeeded" = "fresh",
) {
  return recordingDb({
    "project.findUnique": PROJECT,
    "tradie.findUnique": TRADIE,
    // The newest on the thread, and the newest inbound — told apart by the
    // direction filter the second query carries.
    "tradieEmail.findFirst": (args: unknown) =>
      (args as { where: { direction?: string } }).where.direction === "INBOUND"
        ? { emailFrom: "accounts@abc.example" }
        : {
            refToken: "RCTBK-0A1B2C3D4E5F",
            scheduleId: "s_1",
            sentAt: new Date("2026-11-10T00:00:00Z"),
            subject: "RE: Re: Booking – Plumbing rough-in [RCTBK-0A1B2C3D4E5F]",
          },
    "tradieRequestRecipient.findFirst": {
      refToken: "RCTRQ-111111111111",
      sentAt: new Date("2026-11-01T00:00:00Z"),
      subject: "Quote request – Plumbing [RCTRQ-111111111111]",
    },
    ...outbox(state),
    ...overrides,
  });
}

test("the thread merges request emails with filed mail, oldest first", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
    "tradie.findUnique": TRADIE,
    "tradieRequestRecipient.findMany": [
      {
        html: "<p>Please quote</p>",
        id: "r_1",
        sentAt: new Date("2026-11-01T00:00:00Z"),
        subject: "Quote request",
        toAddress: "quotes@abc.example",
      },
    ],
    "tradieEmail.findMany": [
      {
        body: "Yes, $4,800",
        direction: "INBOUND",
        emailFrom: "quotes@abc.example",
        emailTo: "info@royal.example",
        hasAttachments: false,
        id: "m_2",
        sentAt: new Date("2026-11-03T00:00:00Z"),
        subject: "Re: Quote request",
      },
      {
        body: "Reminder",
        direction: "OUTBOUND",
        emailFrom: null,
        emailTo: "quotes@abc.example",
        hasAttachments: false,
        id: "m_1",
        sentAt: new Date("2026-10-31T00:00:00Z"),
        subject: "Reminder",
      },
    ],
  });
  const thread = await getTradieProjectThread(
    adminPrincipal(),
    { projectId: "p_1", tradieId: "t_1" },
    recorder.db,
  );
  assert.deepEqual(
    thread.messages.map((message) => message.id),
    ["m_1", "request:r_1", "m_2"],
  );
  assert.equal(thread.messages[1].source, "request");
  assert.equal(thread.messages[1].direction, "OUTBOUND");
  assert.equal(thread.replyBlockedBy, null);
  assert.deepEqual(recorder.writes(), []);
});

test("a caller who cannot manage the project gets no thread", async () => {
  const recorder = recordingDb({
    "project.findUnique": PROJECT,
  });
  await assert.rejects(
    getTradieProjectThread(
      customerPrincipal(),
      { projectId: "p_1", tradieId: "t_1" },
      recorder.db,
    ),
    DomainAuthorizationError,
  );
});

test("a reply keeps the thread's newest reference and goes where the tradie last wrote from", async () => {
  const sent: { to: string; subject: string; body: string }[] = [];
  const recorder = replyDb();
  const result = await replyOnTradieThread(
    adminPrincipal(),
    {
      attemptKey: "a_1",
      body: "Can you do the 14th?\nMorning is best.",
      now: new Date("2026-11-20T00:00:00Z"),
      projectId: "p_1",
      tradieId: "t_1",
    },
    recorder.db,
    async (message) => {
      sent.push({ ...message });
    },
  );

  assert.equal(sent.length, 1);
  // The booking reference (newest) rather than the older request's, once,
  // with the stacked "RE: Re:" collapsed into one.
  assert.equal(
    sent[0].subject,
    "Re: Booking – Plumbing rough-in [RCTBK-0A1B2C3D4E5F]",
  );
  // An address on their record, so it is the one to answer.
  assert.equal(sent[0].to, "accounts@abc.example");
  assert.equal(
    sent[0].body,
    "<p>Can you do the 14th?<br/>Morning is best.</p>",
  );
  assert.deepEqual(result, {
    alreadySent: false,
    subject: sent[0].subject,
    to: "accounts@abc.example",
  });

  const upsert = recorder
    .writes()
    .find((write) => write.operation === "outboxEvent.upsert");
  assert.match(
    (upsert?.args as { where: { key: string } }).where.key,
    /^tradie-thread-reply:p_1:t_1:a_1$/,
  );
  const filed = recorder
    .writes()
    .find((write) => write.operation === "tradieEmail.createMany");
  const row = (filed?.args as { data: Record<string, unknown>[] }).data[0];
  assert.equal(row.direction, "OUTBOUND");
  assert.equal(row.projectId, "p_1");
  assert.equal(row.scheduleId, "s_1");
  assert.equal(row.refToken, "RCTBK-0A1B2C3D4E5F");
});

test("a reply from an address not on the tradie's record goes to their primary email", async () => {
  const sent: string[] = [];
  await replyOnTradieThread(
    adminPrincipal(),
    { attemptKey: "a_1", body: "Hi", projectId: "p_1", tradieId: "t_1" },
    replyDb({
      "tradieEmail.findFirst": (args: unknown) =>
        (args as { where: { direction?: string } }).where.direction
        === "INBOUND"
          ? { emailFrom: "forwarded@elsewhere.example" }
          : null,
    }).db,
    async (message) => {
      sent.push(message.to);
    },
  );
  assert.deepEqual(sent, ["quotes@abc.example"]);
});

test("a replayed attempt sends nothing and files nothing, and says so", async () => {
  let sent = 0;
  const recorder = replyDb({}, "succeeded");
  const result = await replyOnTradieThread(
    adminPrincipal(),
    { attemptKey: "a_1", body: "Hi", projectId: "p_1", tradieId: "t_1" },
    recorder.db,
    async () => {
      sent += 1;
    },
  );
  assert.equal(sent, 0);
  assert.equal(result.alreadySent, true);
  assert.ok(
    !recorder
      .writes()
      .some((write) => write.operation === "tradieEmail.createMany"),
  );
});

test("a failed send is refused as unconfirmed and files nothing", async () => {
  const recorder = replyDb();
  await assert.rejects(
    replyOnTradieThread(
      adminPrincipal(),
      { attemptKey: "a_1", body: "Hi", projectId: "p_1", tradieId: "t_1" },
      recorder.db,
      async () => {
        throw new Error("Graph 503");
      },
    ),
    (error: unknown) =>
      error instanceof DomainSideEffectError
      && /Sent Items/.test(error.message),
  );
  assert.ok(
    !recorder
      .writes()
      .some((write) => write.operation === "tradieEmail.createMany"),
  );
});

test("an empty message, a removed tradie and a tradie never asked are refused before anything is sent", async () => {
  const send = async () => {
    throw new Error("must not send");
  };

  const empty = replyDb();
  await assert.rejects(
    replyOnTradieThread(
      adminPrincipal(),
      { attemptKey: "a_1", body: "   ", projectId: "p_1", tradieId: "t_1" },
      empty.db,
      send,
    ),
    DomainValidationError,
  );
  assert.deepEqual(empty.writes(), []);

  const removed = replyDb({
    "tradie.findUnique": { ...TRADIE, archivedAt: new Date() },
  });
  await assert.rejects(
    replyOnTradieThread(
      adminPrincipal(),
      { attemptKey: "a_1", body: "Hi", projectId: "p_1", tradieId: "t_1" },
      removed.db,
      send,
    ),
    DomainTransitionError,
  );
  assert.deepEqual(removed.writes(), []);

  const stranger = replyDb({
    "tradieEmail.findFirst": null,
    "tradieRequestRecipient.findFirst": null,
    "tradieSchedule.findFirst": null,
  });
  await assert.rejects(
    replyOnTradieThread(
      adminPrincipal(),
      { attemptKey: "a_1", body: "Hi", projectId: "p_1", tradieId: "t_1" },
      stranger.db,
      send,
    ),
    DomainTransitionError,
  );
  assert.deepEqual(stranger.writes(), []);
});

test("a referenced reply is filed on the project and booking its reference names", async () => {
  const recorder = recordingDb();
  const filed = await recordInboundTradieEmail(
    {
      body: "Confirmed",
      from: "quotes@abc.example",
      graphMessageId: "g_1",
      hasAttachments: true,
      receivedAt: new Date("2026-11-19T01:00:00Z"),
      reference: {
        projectId: "p_1",
        scope: { scheduleId: "s_1" },
        token: "RCTBK-0A1B2C3D4E5F",
      },
      subject: "Re: Booking [RCTBK-0A1B2C3D4E5F]",
      to: "info@royal.example",
      tradieId: "t_1",
    },
    recorder.db,
  );
  assert.deepEqual(filed, { projectId: "p_1", recorded: true });
  const args = recorder.writes()[0].args as {
    data: Record<string, unknown>[];
    skipDuplicates: boolean;
  };
  assert.equal(args.skipDuplicates, true);
  assert.equal(args.data[0].direction, "INBOUND");
  assert.equal(args.data[0].scheduleId, "s_1");
  assert.equal(args.data[0].graphMessageId, "g_1");
  assert.equal(args.data[0].hasAttachments, true);
});

test("an unreferenced message is filed on the tradie's one open project, and on none when there are several", async () => {
  const inbound = {
    body: "Running late",
    from: "quotes@abc.example",
    graphMessageId: "g_2",
    hasAttachments: false,
    receivedAt: new Date("2026-11-19T01:00:00Z"),
    reference: null,
    subject: "Tomorrow",
    to: "info@royal.example",
    tradieId: "t_1",
  };

  const one = await recordInboundTradieEmail(
    inbound,
    recordingDb({ "tradieSchedule.findMany": [{ projectId: "p_1" }] }).db,
  );
  assert.equal(one.projectId, "p_1");

  const several = await recordInboundTradieEmail(
    inbound,
    recordingDb({
      "tradieSchedule.findMany": [{ projectId: "p_1" }, { projectId: "p_2" }],
    }).db,
  );
  assert.equal(several.projectId, null);
});

test("the reply body is escaped and laid out as paragraphs", () => {
  assert.equal(
    tradieReplyHtml("Hi <b>Bob</b> & co\n\nThanks"),
    "<p>Hi &lt;b&gt;Bob&lt;/b&gt; &amp; co</p><p>Thanks</p>",
  );
  assert.equal(stripReplyPrefixes("Re: FW: re:  Booking"), "Booking");
});

test("compliance uploads wait for the File row instead of sleeping on the webhook", () => {
  const hook = readFileSync(
    join(REPO_ROOT, "hooks/use-compliance-upload.ts"),
    "utf8",
  );
  // The Blob callback skips a project-file upload, and the hook confirms it
  // synchronously before handing back the id.
  assert.match(hook, /uploadType: "project-file"/);
  assert.match(hook, /await completeProjectUpload\(/);

  for (const file of [
    "components/projects/detail/compliance-tab/project-compliance-tab.tsx",
    "components/modals/compliance/connect-party-modal.tsx",
  ]) {
    assert.doesNotMatch(
      readFileSync(join(REPO_ROOT, file), "utf8"),
      /setTimeout\(resolve, 850\)/,
      `${file} still sleeps before attaching an upload`,
    );
  }
});
