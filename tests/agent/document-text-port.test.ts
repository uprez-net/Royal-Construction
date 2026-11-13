import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

const ocr = vi.hoisted(() => ({
  ocrDocumentAtUrl: vi.fn<(input: object) => Promise<string[]>>(async () => [
    "page one",
    "page two",
  ]),
  configured: true,
}));
vi.mock("@/lib/ocr", () => ({
  isOcrConfigured: () => ocr.configured,
  ocrDocumentAtUrl: ocr.ocrDocumentAtUrl,
}));

const { MAX_OCR_BYTES, documentReading, documentTextReader, sheetAsText } =
  await import("@/lib/document-text-port");

// How the document index reads each kind of upload. OCR is mocked: what is
// under test is which reader a file goes to, and what is refused.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  ocr.configured = true;
  vi.clearAllMocks();
});

test("each kind of upload goes to the reader that can read it", () => {
  assert.equal(
    documentReading("Survey.pdf", "application/pdf"),
    "ocr-document",
  );
  assert.equal(
    documentReading(
      "Spec.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "ocr-document",
  );
  assert.equal(documentReading("site.jpg", "image/jpeg"), "ocr-image");
  assert.equal(documentReading("quote.xlsx", ""), "spreadsheet");
  assert.equal(
    documentReading("notes.txt", "text/plain; charset=utf-8"),
    "text",
  );
  // A phone or a mailbox often says octet-stream; the extension decides.
  assert.equal(
    documentReading("Plans.PDF", "application/octet-stream"),
    "ocr-document",
  );
  assert.equal(documentReading("walkthrough.mp4", "video/mp4"), null);
  assert.equal(documentReading("drawings.dwg", "application/acad"), null);
});

test("a PDF is read by OCR from its URL, page by page", async () => {
  const result = await documentTextReader.extract({
    filename: "Survey.pdf",
    mediaType: "application/pdf",
    sizeBytes: 1_000,
    url: "https://blob.example/survey.pdf",
  });
  assert.deepEqual(result, { pages: ["page one", "page two"], status: "text" });
  assert.deepEqual(ocr.ocrDocumentAtUrl.mock.calls[0]?.[0], {
    isImage: false,
    name: "Survey.pdf",
    timeoutMs: 120_000,
    url: "https://blob.example/survey.pdf",
  });
});

test("what cannot be read is reported unsupported, without calling OCR", async () => {
  const video = await documentTextReader.extract({
    filename: "walkthrough.mp4",
    mediaType: "video/mp4",
    sizeBytes: 1_000,
    url: "https://blob.example/walk.mp4",
  });
  assert.equal(video.status, "unsupported");
  const huge = await documentTextReader.extract({
    filename: "Plans.pdf",
    mediaType: "application/pdf",
    sizeBytes: MAX_OCR_BYTES + 1,
    url: "https://blob.example/plans.pdf",
  });
  assert.equal(huge.status, "unsupported");
  assert.equal(ocr.ocrDocumentAtUrl.mock.calls.length, 0);
});

test("a missing OCR key is the reader being unavailable, not the document", async () => {
  ocr.configured = false;
  const result = await documentTextReader.extract({
    filename: "Survey.pdf",
    mediaType: "application/pdf",
    sizeBytes: 1_000,
    url: "https://blob.example/survey.pdf",
  });
  assert.equal(result.status, "unavailable");
  assert.equal(ocr.ocrDocumentAtUrl.mock.calls.length, 0);
});

test("a text file is read as it is", async () => {
  globalThis.fetch = (async () =>
    new Response("Front setback 6.0 m", { status: 200 })) as typeof fetch;
  const result = await documentTextReader.extract({
    filename: "notes.txt",
    mediaType: "text/plain",
    sizeBytes: 19,
    url: "https://blob.example/notes.txt",
  });
  assert.deepEqual(result, { pages: ["Front setback 6.0 m"], status: "text" });
});

test("a download that fails is a failure to retry", async () => {
  globalThis.fetch = (async () =>
    new Response("gone", { status: 404 })) as typeof fetch;
  await assert.rejects(
    documentTextReader.extract({
      filename: "notes.txt",
      mediaType: "text/plain",
      sizeBytes: 4,
      url: "https://blob.example/notes.txt",
    }),
    /HTTP 404/,
  );
});

test("a worksheet reads as one line per row, empty rows and trailing cells dropped", () => {
  assert.equal(
    sheetAsText("Quote", [
      ["Item", "Qty", "Rate", ""],
      ["", "", "", ""],
      ["Slab  pour", "1", "$18,400", ""],
    ]),
    ["## Quote", "Item | Qty | Rate", "Slab pour | 1 | $18,400"].join("\n"),
  );
});

test("a spreadsheet is read cell by cell, a worksheet to a page", async () => {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  workbook.addWorksheet("Quote").addRows([
    ["Item", "Amount"],
    ["Slab", 18_400],
  ]);
  workbook.addWorksheet("Notes").addRow(["Excludes rock removal"]);
  const data = await workbook.xlsx.writeBuffer();
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(data as ArrayBuffer), {
      status: 200,
    })) as typeof fetch;

  const result = await documentTextReader.extract({
    filename: "quote.xlsx",
    mediaType: "application/octet-stream",
    sizeBytes: null,
    url: "https://blob.example/quote.xlsx",
  });
  assert.equal(result.status, "text");
  const pages = result.status === "text" ? result.pages : [];
  assert.equal(pages.length, 2);
  assert.match(pages[0]!, /^## Quote\nItem \| Amount\nSlab \| 18,?400$/);
  assert.equal(pages[1], "## Notes\nExcludes rock removal");
  assert.equal(ocr.ocrDocumentAtUrl.mock.calls.length, 0);
});
