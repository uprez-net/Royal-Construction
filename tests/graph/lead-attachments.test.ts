import assert from "node:assert/strict";
import { test } from "node:test";

import { GraphRequestError, type GraphAttachmentMetadata } from "../../lib/graph/client";
import {
  collectLeadAttachments,
  resolveMediaType,
  selectLeadAttachments,
  type LeadAttachmentSource,
} from "../../lib/graph/lead-attachments";

const MB = 1024 * 1024;

function attachment(
  overrides: Partial<GraphAttachmentMetadata> = {},
): GraphAttachmentMetadata {
  return {
    id: overrides.id ?? `id-${overrides.name ?? "file"}`,
    name: "plans.pdf",
    contentType: "application/pdf",
    size: 1024,
    isInline: false,
    odataType: "#microsoft.graph.fileAttachment",
    ...overrides,
  };
}

function namesOf(items: { name: string }[]): string[] {
  return items.map((item) => item.name);
}

test("a client's plans and photos are selected", () => {
  const { selected, skipped } = selectLeadAttachments([
    attachment({ name: "floor-plans.pdf" }),
    attachment({ name: "site.JPG", contentType: "image/jpeg", size: 2 * MB }),
  ]);

  assert.deepEqual(namesOf(selected), ["floor-plans.pdf", "site.JPG"]);
  assert.deepEqual(skipped, []);
});

test("the extension wins over a generic Content-Type", () => {
  // Outlook and form relays routinely label a PDF as octet-stream; going by the
  // declared type alone dropped every one of them.
  assert.equal(
    resolveMediaType("plans.pdf", "application/octet-stream"),
    "application/pdf",
  );
  assert.equal(resolveMediaType("photo.JPEG", ""), "image/jpeg");
  assert.equal(resolveMediaType("noextension", "image/png"), "image/png");
  assert.equal(resolveMediaType("brief.txt", "text/plain; charset=utf-8"), "text/plain");

  const { selected } = selectLeadAttachments([
    attachment({ name: "plans.pdf", contentType: "application/octet-stream" }),
  ]);
  assert.deepEqual(namesOf(selected), ["plans.pdf"]);
});

test("signature logos and tracking pixels are left behind", () => {
  const { selected, skipped } = selectLeadAttachments([
    attachment({ name: "logo.png", contentType: "image/png", size: 8 * 1024, isInline: true }),
    attachment({ name: "pixel.gif", contentType: "image/gif", size: 43, isInline: true }),
  ]);

  assert.deepEqual(selected, []);
  assert.equal(skipped.length, 2);
});

test("a large pasted image is kept even though it is inline", () => {
  // Outlook marks a photo dropped into the body as inline. That photo is
  // frequently the entire enquiry, so size — not the inline flag — decides.
  const { selected } = selectLeadAttachments([
    attachment({ name: "backyard.jpg", contentType: "image/jpeg", size: 900 * 1024, isInline: true }),
  ]);

  assert.deepEqual(namesOf(selected), ["backyard.jpg"]);
});

test("formats the model cannot read are skipped with a reason", () => {
  const { selected, skipped } = selectLeadAttachments([
    attachment({ name: "plans.dwg", contentType: "application/acad" }),
    attachment({ name: "brief.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
  ]);

  assert.deepEqual(selected, []);
  assert.deepEqual(namesOf(skipped), ["plans.dwg", "brief.docx"]);
  assert.ok(skipped[0].reason.includes("unreadable"));
});

test("linked and forwarded-email attachments are skipped", () => {
  // Neither has bytes behind /$value, so downloading one is a guaranteed error.
  const { selected, skipped } = selectLeadAttachments([
    attachment({ name: "OneDrive plans.pdf", odataType: "#microsoft.graph.referenceAttachment" }),
    attachment({ name: "Fwd enquiry", odataType: "#microsoft.graph.itemAttachment" }),
  ]);

  assert.deepEqual(selected, []);
  assert.equal(skipped.length, 2);
  assert.ok(skipped[0].reason.includes("unsupported attachment type"));
});

test("an oversized file is skipped but the rest of the message is not", () => {
  const { selected, skipped } = selectLeadAttachments([
    attachment({ name: "walkthrough.pdf", size: 40 * MB }),
    attachment({ name: "plans.pdf", size: 2 * MB }),
  ]);

  assert.deepEqual(namesOf(selected), ["plans.pdf"]);
  assert.deepEqual(namesOf(skipped), ["walkthrough.pdf"]);
  assert.ok(skipped[0].reason.includes("per-file limit"));
});

test("the total request budget is enforced across files", () => {
  const { selected, skipped } = selectLeadAttachments([
    attachment({ name: "a.pdf", size: 9 * MB }),
    attachment({ name: "b.pdf", size: 9 * MB }),
    attachment({ name: "c.pdf", size: 1 * MB }),
  ]);

  // b.pdf would take the request over 15 MB; c.pdf still fits underneath it.
  assert.deepEqual(namesOf(selected), ["a.pdf", "c.pdf"]);
  assert.deepEqual(namesOf(skipped), ["b.pdf"]);
  assert.ok(skipped[0].reason.includes("total limit"));
});

test("no more than five attachments go up", () => {
  const { selected, skipped } = selectLeadAttachments(
    Array.from({ length: 7 }, (_, index) =>
      attachment({ name: `page-${index}.pdf`, id: `id-${index}` }),
    ),
  );

  assert.equal(selected.length, 5);
  assert.equal(skipped.length, 2);
});

function sourceFor(
  metadata: GraphAttachmentMetadata[],
  bytes: Record<string, Buffer | Error> = {},
): LeadAttachmentSource {
  return {
    listMessageAttachments: async () => metadata,
    downloadMessageAttachment: async (_messageId, attachmentId) => {
      const result = bytes[attachmentId];
      if (result instanceof Error) throw result;
      return result ?? Buffer.from("pdf-bytes");
    },
  };
}

test("readable files come back as bytes and text files as characters", async () => {
  const metadata = [
    attachment({ id: "a", name: "plans.pdf" }),
    attachment({ id: "b", name: "brief.txt", contentType: "text/plain" }),
  ];
  const set = await collectLeadAttachments(
    sourceFor(metadata, { b: Buffer.from("Knockdown rebuild in Parramatta") }),
    "message-1",
  );

  assert.deepEqual(set.names, ["plans.pdf", "brief.txt"]);
  assert.deepEqual(
    set.attachments.map((item) => item.kind),
    ["file", "text"],
  );
  const [file, text] = set.attachments;
  assert.equal(file.kind === "file" && file.mediaType, "application/pdf");
  assert.equal(text.kind === "text" && text.text, "Knockdown rebuild in Parramatta");
});

test("the names of unreadable attachments still reach the extractor", async () => {
  // The model is told plans.dwg arrived even though it cannot open it —
  // otherwise a "plans attached" enquiry reads as an empty message and is
  // scored as spam.
  const set = await collectLeadAttachments(
    sourceFor([attachment({ id: "a", name: "plans.dwg", contentType: "application/acad" })]),
    "message-1",
  );

  assert.deepEqual(set.names, ["plans.dwg"]);
  assert.deepEqual(set.attachments, []);
  assert.deepEqual(namesOf(set.skipped), ["plans.dwg"]);
});

test("a failed download does not lose the other attachments or throw", async () => {
  // A 404 is an answer, so this one is skipped without burning retries on it.
  const metadata = [
    attachment({ id: "a", name: "broken.pdf" }),
    attachment({ id: "b", name: "plans.pdf" }),
  ];
  const set = await collectLeadAttachments(
    sourceFor(metadata, { a: new GraphRequestError("Graph error 404", 404) }),
    "message-1",
  );

  assert.deepEqual(
    set.attachments.map((item) => item.name),
    ["plans.pdf"],
  );
  assert.deepEqual(set.skipped, [{ name: "broken.pdf", reason: "download failed" }]);
});

test("a throttled download is retried rather than skipped", async () => {
  // Graph throttles hard under a burst of notifications. Now that this runs
  // after the 202, waiting it out is cheaper than losing the client's plans.
  let calls = 0;
  const set = await collectLeadAttachments(
    {
      listMessageAttachments: async () => [attachment({ id: "a", name: "plans.pdf" })],
      downloadMessageAttachment: async () => {
        calls += 1;
        if (calls === 1) throw new GraphRequestError("throttled", 429, 0);
        return Buffer.from("pdf-bytes");
      },
    },
    "message-1",
  );

  assert.equal(calls, 2);
  assert.deepEqual(
    set.attachments.map((item) => item.name),
    ["plans.pdf"],
  );
  assert.deepEqual(set.skipped, []);
});

test("a failed listing degrades to extracting from the body alone", async () => {
  const set = await collectLeadAttachments(
    {
      listMessageAttachments: async () => {
        throw new GraphRequestError("Graph error 403", 403);
      },
      downloadMessageAttachment: async () => Buffer.alloc(0),
    },
    "message-1",
  );

  assert.deepEqual(set, { names: [], attachments: [], skipped: [] });
});

test("a message with no attachments costs nothing beyond the listing", async () => {
  let downloads = 0;
  const set = await collectLeadAttachments(
    {
      listMessageAttachments: async () => [],
      downloadMessageAttachment: async () => {
        downloads += 1;
        return Buffer.alloc(0);
      },
    },
    "message-1",
  );

  assert.equal(downloads, 0);
  assert.deepEqual(set.names, []);
});
