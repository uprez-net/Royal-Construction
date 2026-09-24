import assert from "node:assert/strict";

import { test } from "vitest";

import {
  parseOfferReplyAttachments,
  recordOfferReply,
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

const SEND = {
  id: "send_1",
  offerId: "offer_1",
  recipientEmail: "Jo@Example.test",
  repliedAt: null,
};

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
  options: { failDownloadOf?: string; failList?: boolean } = {},
) {
  const downloads: string[] = [];
  return {
    downloads,
    port: {
      downloadAttachment: async (id: string) => {
        downloads.push(id);
        if (id === options.failDownloadOf) throw new Error("Graph 503");
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

function storedAttachments(
  recorder: ReturnType<typeof recordingDb>,
): OfferReplyAttachment[] {
  const updates = recorder
    .writes()
    .filter((call) => call.operation === "offerDocumentReply.update");
  const last = updates.at(-1) as
    | { args: { data: { attachments: OfferReplyAttachment[] } } }
    | undefined;
  assert.ok(last, "the attachment outcome was never written back");
  return last.args.data.attachments;
}

test("a reply from someone other than the recipient records nothing", async () => {
  const recorder = recordingDb({ "offerDocumentSend.findUnique": SEND });
  const mailbox = mail([attachment({})]);

  const outcome = await recordOfferReply(
    WEBHOOK,
    { ...REPLY, from: "someone-else@example.test" },
    recorder.db,
    { mail: mailbox.port, put: blobStore().put },
  );

  assert.equal(outcome, "sender-mismatch");
  assert.deepEqual(recorder.writes(), []);
  assert.deepEqual(mailbox.downloads, []);
});

test("a bounce quoting the offer's subject records nothing", async () => {
  const recorder = recordingDb({ "offerDocumentSend.findUnique": SEND });

  const outcome = await recordOfferReply(
    WEBHOOK,
    { ...REPLY, headers: { autoSubmitted: "auto-replied" } },
    recorder.db,
    { mail: mail([]).port, put: blobStore().put },
  );

  assert.equal(outcome, "auto-generated");
  assert.deepEqual(recorder.writes(), []);
});

test("only the mailbox integration may record a reply", async () => {
  const recorder = recordingDb({ "offerDocumentSend.findUnique": SEND });

  await assert.rejects(
    recordOfferReply(adminPrincipal(), REPLY, recorder.db, {
      mail: mail([]).port,
      put: blobStore().put,
    }),
    /mailbox integration/,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a reply is stored with its message, its timestamps and its files", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": { id: "reply_1" },
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
  });
  const store = blobStore();
  const mailbox = mail([
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
  ]);

  const outcome = await recordOfferReply(WEBHOOK, REPLY, recorder.db, {
    mail: mailbox.port,
    put: store.put,
  });

  assert.equal(outcome, "recorded");
  assert.deepEqual(mailbox.downloads, ["att_plans"]);
  assert.equal(store.paths.length, 1);
  assert.match(
    store.paths[0],
    /^offers\/offer_1\/reply-[0-9a-f]{32}-plans\.pdf$/,
  );

  const create = recorder
    .writes()
    .find((call) => call.operation === "offerDocumentReply.create") as {
    args: { data: Record<string, unknown> };
  };
  assert.equal(create.args.data.body, REPLY.body);
  assert.equal(create.args.data.sendId, "send_1");
  assert.equal(create.args.data.fromEmail, "jo@example.test");

  const stamp = recorder
    .writes()
    .find((call) => call.operation === "offerDocumentSend.update") as {
    args: { data: Record<string, unknown> };
  };
  assert.deepEqual(stamp.args.data, {
    lastReplyAt: new Date(REPLY.receivedAt as string),
    repliedAt: new Date(REPLY.receivedAt as string),
  });

  const stored = storedAttachments(recorder);
  assert.deepEqual(
    stored.map((file) => [file.name, file.url !== null]),
    [
      ["plans.pdf", true],
      ["walkthrough.mov", false],
      ["Fwd: council letter", false],
    ],
  );
  assert.equal(stored[0].note, null);
  assert.match(stored[1].note ?? "", /Too large/);
  assert.match(stored[2].note ?? "", /forwarded email/);
});

test("a later reply moves lastReplyAt and leaves repliedAt alone", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": { id: "reply_2" },
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": {
      ...SEND,
      repliedAt: new Date("2026-09-20T00:00:00.000Z"),
    },
  });

  await recordOfferReply(WEBHOOK, REPLY, recorder.db, {
    mail: mail([]).port,
    put: blobStore().put,
  });

  const stamp = recorder
    .writes()
    .find((call) => call.operation === "offerDocumentSend.update") as {
    args: { data: Record<string, unknown> };
  };
  assert.deepEqual(Object.keys(stamp.args.data), ["lastReplyAt"]);
});

test("a repeated notification for the same message records nothing", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.findUnique": { id: "reply_1" },
    "offerDocumentSend.findUnique": SEND,
  });
  const mailbox = mail([attachment({})]);

  const outcome = await recordOfferReply(WEBHOOK, REPLY, recorder.db, {
    mail: mailbox.port,
    put: blobStore().put,
  });

  assert.equal(outcome, "already-recorded");
  assert.deepEqual(recorder.writes(), []);
  assert.deepEqual(mailbox.downloads, []);
});

test("a file that fails to download keeps the reply and says it was not saved", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": { id: "reply_1" },
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
  });

  const outcome = await recordOfferReply(WEBHOOK, REPLY, recorder.db, {
    mail: mail(
      [
        attachment({ id: "att_a", name: "a.pdf" }),
        attachment({ id: "att_b", name: "b.pdf" }),
      ],
      { failDownloadOf: "att_a" },
    ).port,
    put: blobStore().put,
  });

  assert.equal(outcome, "recorded");
  const stored = storedAttachments(recorder);
  assert.equal(stored[0].url, null);
  assert.match(stored[0].note ?? "", /Not saved/);
  assert.ok(stored[1].url);
});

test("attachments the mailbox could not list still show as missing", async () => {
  const recorder = recordingDb({
    "offerDocumentReply.create": { id: "reply_1" },
    "offerDocumentReply.findUnique": null,
    "offerDocumentSend.findUnique": SEND,
  });

  await recordOfferReply(WEBHOOK, REPLY, recorder.db, {
    mail: mail([], { failList: true }).port,
    put: blobStore().put,
  });

  const create = recorder
    .writes()
    .find((call) => call.operation === "offerDocumentReply.create") as {
    args: { data: { attachments: OfferReplyAttachment[] } };
  };
  assert.equal(create.args.data.attachments.length, 1);
  assert.equal(create.args.data.attachments[0].url, null);
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
