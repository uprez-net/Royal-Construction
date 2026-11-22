import assert from "node:assert/strict";

import { test } from "vitest";

import {
  parseOfferReplyAttachments,
  planOfferReplyAttachments,
  recordOfferReply,
  storeOfferReplyAttachment,
  type InboundAttachmentMetadata,
  type InboundOfferReply,
  type OfferReplyAttachment,
} from "@/lib/domain/offers/replies";
import { systemPrincipal } from "@/lib/domain/principal";
import { adminPrincipal, recordingDb } from "./domain-harness";

// The client's reply to an offer is recorded whole — the message and what they
// attached — so the negotiation can be read on the offer rather than only in
// the builder's mailbox. These pin the guards that decide whether an inbound
// message is the client at all, and that a file which was not stored says so
// rather than disappearing.

const WEBHOOK = systemPrincipal("graph:offer-reply");

const SEND = { id: "send_1", recipientEmail: "Jo@Example.test" };

const REPLY: InboundOfferReply = {
  body: "Can we drop the pool?\r\n\r\nFrom: Royal Constructions\r\n> the offer",
  from: "jo@example.test",
  graphMessageId: "graph_msg_1",
  hasAttachments: true,
  headers: {},
  receivedAt: "2026-09-24T01:00:00.000Z",
  subject: "RE: Your offer [RCOFR-0123456789AB]",
  token: "RCOFR-0123456789AB",
};

const FILE = "#microsoft.graph.fileAttachment";

const STORED_REPLY = {
  graphMessageId: "graph_msg_1",
  send: { offerId: "offer_1" },
};

function attachment(
  overrides: Partial<InboundAttachmentMetadata>,
): InboundAttachmentMetadata {
  return {
    contentType: "application/pdf",
    id: "att_1",
    isInline: false,
    name: "plans.pdf",
    odataType: FILE,
    size: 200_000,
    ...overrides,
  };
}

function mail(
  listed: readonly InboundAttachmentMetadata[],
  options: { failDownload?: boolean; failList?: boolean } = {},
) {
  const downloads: string[] = [];
  return {
    downloads,
    port: {
      downloadAttachment: async (id: string) => {
        downloads.push(id);
        if (options.failDownload) throw new Error("Graph 503");
        return Buffer.from(`bytes of ${id}`);
      },
      listAttachments: async () => {
        if (options.failList) throw new Error("Graph 503");
        return listed;
      },
    },
  };
}

function blobStore() {
  const paths: string[] = [];
  return {
    paths,
    put: async ({ pathname }: { pathname: string }) => {
      paths.push(pathname);
      return { url: `https://blob.example.test/${pathname}` };
    },
  };
}

function written<T>(
  recorder: ReturnType<typeof recordingDb>,
  operation: string,
): { where: Record<string, unknown>; data: T }[] {
  return recorder
    .writes()
    .filter((call) => call.operation === operation)
    .map((call) => call.args as { where: Record<string, unknown>; data: T });
}

// --- recording the message ------------------------------------------------

test("a reply from someone other than the recipient records nothing", async () => {
  const recorder = recordingDb({ "offerDocumentSend.findUnique": SEND });

  const record = await recordOfferReply(
    WEBHOOK,
    { ...REPLY, from: "someone-else@example.test" },
    recorder.transactionalDb,
  );

  assert.equal(record.outcome, "sender-mismatch");
  assert.deepEqual(recorder.writes(), []);
});

test("a bounce quoting the offer's subject records nothing", async () => {
  const recorder = recordingDb({ "offerDocumentSend.findUnique": SEND });

  const record = await recordOfferReply(
    WEBHOOK,
    { ...REPLY, headers: { autoSubmitted: "auto-replied" } },
    recorder.transactionalDb,
  );

  assert.equal(record.outcome, "auto-generated");
  assert.deepEqual(recorder.writes(), []);
});

test("only the mailbox integration may record a reply", async () => {
  const recorder = recordingDb({ "offerDocumentSend.findUnique": SEND });

  await assert.rejects(
    recordOfferReply(adminPrincipal(), REPLY, recorder.transactionalDb),
    /mailbox integration/,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a repeated notification for the same message records nothing", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.findUnique": { id: "reply_1" },
    "offerDocumentSend.findUnique": SEND,
  });

  const record = await recordOfferReply(
    WEBHOOK,
    REPLY,
    recorder.transactionalDb,
  );

  assert.equal(record.outcome, "already-recorded");
  assert.deepEqual(recorder.writes(), []);
});

test("a reply is stored with its message and hands back the row to finish", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": { id: "reply_1" },
    "offerDocumentReply.findFirst": null,
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
  });

  const record = await recordOfferReply(
    WEBHOOK,
    REPLY,
    recorder.transactionalDb,
  );

  assert.deepEqual(record, { outcome: "recorded", replyId: "reply_1" });
  const [create] = written<Record<string, unknown>>(
    recorder,
    "offerDocumentReply.create",
  );
  assert.equal(create.data.body, REPLY.body);
  assert.equal(create.data.sendId, "send_1");
  assert.equal(create.data.fromEmail, "jo@example.test");
  // Graph said there were files; until the workflow lists them, the row says
  // they are on their way rather than showing none.
  assert.match(
    (create.data.attachments as OfferReplyAttachment[])[0].note ?? "",
    /Still being saved/,
  );
});

test("the reply timestamps are decided by the database, not by the read", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": { id: "reply_1" },
    "offerDocumentReply.findFirst": null,
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
  });

  await recordOfferReply(WEBHOOK, REPLY, recorder.transactionalDb);

  const at = new Date(REPLY.receivedAt as string);
  assert.deepEqual(
    written(recorder, "offerDocumentSend.updateMany").map((call) => call),
    [
      {
        data: { repliedAt: at },
        where: {
          id: "send_1",
          OR: [{ repliedAt: null }, { repliedAt: { gt: at } }],
        },
      },
      {
        data: { lastReplyAt: at },
        where: {
          id: "send_1",
          OR: [{ lastReplyAt: null }, { lastReplyAt: { lt: at } }],
        },
      },
    ],
  );
  assert.deepEqual(written(recorder, "offerDocumentSend.update"), []);
});

test("a failed timestamp write fails the record, so the row rolls back with it", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": { id: "reply_1" },
    "offerDocumentReply.findFirst": null,
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
    "offerDocumentSend.updateMany": () => {
      throw new Error("connection reset");
    },
  });

  await assert.rejects(
    recordOfferReply(WEBHOOK, REPLY, recorder.transactionalDb),
    /connection reset/,
  );
});

test("the notification that loses the insert race reports already-recorded", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": () => {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    },
    "offerDocumentReply.findFirst": null,
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
  });

  const record = await recordOfferReply(
    WEBHOOK,
    REPLY,
    recorder.transactionalDb,
  );

  assert.equal(record.outcome, "already-recorded");
});

// --- the attachment workflow ------------------------------------------------

test("the plan lists every file the client sent and stores only the fitting ones", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.findUnique": STORED_REPLY,
  });

  const plan = await planOfferReplyAttachments(
    WEBHOOK,
    { replyId: "reply_1" },
    recorder.db,
    {
      mail: mail([
        attachment({ id: "att_plans", name: "plans.pdf" }),
        // A signature logo: not something the client sent us.
        attachment({
          contentType: "image/png",
          id: "att_logo",
          isInline: true,
          name: "logo.png",
          size: 3_000,
        }),
        attachment({
          id: "att_video",
          name: "walkthrough.mov",
          size: 90 * 1024 * 1024,
        }),
        attachment({
          id: "att_fwd",
          name: "Fwd: council letter",
          odataType: "#microsoft.graph.itemAttachment",
        }),
      ]).port,
    },
  );

  assert.deepEqual(
    plan.files.map((file) => [file.index, file.attachmentId]),
    [[0, "att_plans"]],
  );
  assert.equal(plan.offerId, "offer_1");

  const [update] = written<{ attachments: OfferReplyAttachment[] }>(
    recorder,
    "offerDocumentReply.update",
  );
  assert.deepEqual(
    update.data.attachments.map((file) => file.name),
    ["plans.pdf", "walkthrough.mov", "Fwd: council letter"],
  );
  assert.match(update.data.attachments[0].note ?? "", /Not saved/);
  assert.match(update.data.attachments[1].note ?? "", /Too large/);
  assert.match(update.data.attachments[2].note ?? "", /forwarded email/);
});

test("attachments the mailbox could not list say so instead of 'still saving'", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.findUnique": STORED_REPLY,
  });

  const plan = await planOfferReplyAttachments(
    WEBHOOK,
    { replyId: "reply_1" },
    recorder.db,
    { mail: mail([], { failList: true }).port },
  );

  assert.deepEqual(plan.files, []);
  const [update] = written<{ attachments: OfferReplyAttachment[] }>(
    recorder,
    "offerDocumentReply.update",
  );
  assert.equal(update.data.attachments.length, 1);
  assert.match(update.data.attachments[0].note ?? "", /Couldn't be read/);
});

const PLAN = {
  graphMessageId: "graph_msg_1",
  offerId: "offer_1",
  replyId: "reply_1",
};
const PLANNED = {
  attachmentId: "att_plans",
  contentType: "application/pdf",
  index: 0,
  name: "plans.pdf",
};

test("a stored file links on its row under a path a retry overwrites", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.findUnique": {
      attachments: [
        {
          contentType: "application/pdf",
          name: "plans.pdf",
          note: "Not saved",
          size: 200_000,
          url: null,
        },
      ],
    },
  });
  const store = blobStore();

  await storeOfferReplyAttachment(
    WEBHOOK,
    { file: PLANNED, plan: PLAN },
    recorder.db,
    { mail: mail([]).port, put: store.put },
  );
  await storeOfferReplyAttachment(
    WEBHOOK,
    { file: PLANNED, plan: PLAN },
    recorder.db,
    { mail: mail([]).port, put: store.put },
  );

  assert.equal(store.paths.length, 2);
  assert.equal(store.paths[0], store.paths[1]);
  assert.match(
    store.paths[0],
    /^offers\/offer_1\/reply-[0-9a-f]{32}-plans\.pdf$/,
  );
  const [update] = written<{ attachments: OfferReplyAttachment[] }>(
    recorder,
    "offerDocumentReply.update",
  );
  assert.equal(update.data.attachments[0].note, null);
  assert.equal(
    update.data.attachments[0].url,
    `https://blob.example.test/${store.paths[0]}`,
  );
});

test("a failed download throws for the retry and leaves the row untouched", async () => {
  const recorder = recordingDb({});

  await assert.rejects(
    storeOfferReplyAttachment(
      WEBHOOK,
      { file: PLANNED, plan: PLAN },
      recorder.db,
      { mail: mail([], { failDownload: true }).port, put: blobStore().put },
    ),
    /Graph 503/,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a stored attachment only ever links to https", () => {
  assert.deepEqual(
    parseOfferReplyAttachments([
      { name: "ok.pdf", size: 10, url: "https://blob.example.test/ok.pdf" },
      { name: "bad.pdf", url: "javascript:alert(1)" },
      { url: "https://blob.example.test/nameless" },
      "not an object",
    ]).map((file) => [file.name, file.url]),
    [
      ["ok.pdf", "https://blob.example.test/ok.pdf"],
      ["bad.pdf", null],
    ],
  );
});

test("the same email arriving in the other mailbox is not recorded twice", async () => {
  // Same send, sender, subject and body; a different Graph id, as it has in
  // each mailbox, and a moment later.
  const recorder = recordingDb({
    "offerDocumentReply.findFirst": { id: "reply_1" },
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
  });

  const record = await recordOfferReply(
    WEBHOOK,
    {
      ...REPLY,
      graphMessageId: "graph_msg_in_admin_mailbox",
      receivedAt: "2026-09-24T01:00:03.000Z",
    },
    recorder.transactionalDb,
  );

  assert.equal(record.outcome, "already-recorded");
  assert.deepEqual(recorder.writes(), []);
});
