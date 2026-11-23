import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";

import { buildInboundCertifierRows } from "@/lib/compliance/inbound-rows";

// #587: a certifier's reply quotes our earlier mail. Those quoted copies were
// stored as INBOUND "received from ourselves", beside the OUTBOUND row the
// send itself wrote.
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of [
    "BUSINESS_EMAIL",
    "BUSINESS_ADMIN_EMAIL",
    "GRAPH_SENDER_UPN",
  ]) {
    saved[key] = process.env[key];
  }
  process.env.BUSINESS_EMAIL = "info@royal.test";
  process.env.BUSINESS_ADMIN_EMAIL = "admin@royal.test";
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const thread = (from: string, body: string, to = "") => ({
  body,
  from,
  sentAt: "2026-11-01T00:00:00Z",
  subject: "Documents for the site",
  to,
});

const build = (threads: ReturnType<typeof thread>[]) =>
  buildInboundCertifierRows({
    attachments: [{ name: "a.pdf", url: "https://x/a.pdf" }],
    engagementId: "eng1",
    fallback: {
      from: "cert@certco.test",
      sentAt: new Date("2026-11-02T00:00:00Z"),
      subject: "Re: Documents for the site",
      to: "admin@royal.test",
    },
    graphMailbox: "ADMIN",
    threads,
  });

test("the reply and the certifier's quoted history are stored as inbound", async () => {
  const rows = await build([
    thread("cert@certco.test", "Received, thanks.", "admin@royal.test"),
    thread("cert@certco.test", "Please send the plans."),
  ]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.direction === "INBOUND"));
  // Only the message that just arrived carries the attachments.
  assert.deepEqual(rows[0]?.attachments, [
    { name: "a.pdf", url: "https://x/a.pdf" },
  ]);
  assert.deepEqual(rows[1]?.attachments, []);
});

test("a quoted copy of our own send is not stored as received", async () => {
  const rows = await build([
    thread("cert@certco.test", "Received, thanks.", "admin@royal.test"),
    thread("Admin@Royal.test", "Here are the documents."),
    thread("info@royal.test", "An earlier send."),
  ]);
  assert.deepEqual(
    rows.map((row) => row.emailFrom),
    ["cert@certco.test"],
  );
});

test("a message with no sender header falls back to the envelope sender", async () => {
  const rows = await build([thread("", "Body", "")]);
  assert.equal(rows[0]?.emailFrom, "cert@certco.test");
  assert.equal(rows[0]?.emailTo, "admin@royal.test");
});

test("nothing parsed from quoted text is ever filed as outbound", async () => {
  const rows = await build([
    thread("admin@royal.test", "x"),
    thread("cert@certco.test", "y"),
  ]);
  assert.ok(rows.every((row) => row.direction !== "OUTBOUND"));
});

test("an attachment-only reply keeps a row for the message that arrived", async () => {
  // The body is only our quoted mail, so the parser's newest entry is ours.
  const rows = await build([
    thread("Royal Constructions <admin@royal.test>", "Please send the plans."),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.emailFrom, "cert@certco.test");
  assert.equal(rows[0]?.body, "");
  assert.deepEqual(rows[0]?.attachments, [
    { name: "a.pdf", url: "https://x/a.pdf" },
  ]);
});
