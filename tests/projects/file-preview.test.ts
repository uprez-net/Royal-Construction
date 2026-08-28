import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filePreviewModal,
  isPreviewableImage,
} from "../../utils/file-preview";

const BLOB = "https://x.public.blob.vercel-storage.com/projects/p1";

test("a stored MIME type decides before the extension does", () => {
  // A photo uploaded with no extension is still a photo.
  assert.equal(
    isPreviewableImage({ url: `${BLOB}/abc-screenshot`, fileType: "image/png" }),
    true,
  );
  // And a PDF named like an image is still a PDF.
  assert.equal(
    isPreviewableImage({
      url: `${BLOB}/abc-plan.png`,
      name: "plan.png",
      fileType: "application/pdf",
    }),
    false,
  );
});

test("without a MIME type the name carries the signal", () => {
  for (const name of [
    "site.png",
    "SITE.JPG",
    "kitchen.jpeg",
    "frame.webp",
    "walkthrough.gif",
    "render.avif",
    "photo.heic",
  ]) {
    assert.equal(isPreviewableImage({ url: `${BLOB}/id-${name}`, name }), true, name);
  }

  for (const name of ["survey.pdf", "fees.docx", "costs.xlsx", "notes.txt", "plan"]) {
    assert.equal(isPreviewableImage({ url: `${BLOB}/id-${name}`, name }), false, name);
  }
});

test("SVG is not routed to the picture viewer", () => {
  // next/image rejects SVG unless dangerouslyAllowSVG is set, which it is not,
  // so sending one to the gallery would render a broken image. The document
  // viewer at least offers the file.
  assert.equal(
    isPreviewableImage({ url: `${BLOB}/id-logo.svg`, fileType: "image/svg+xml" }),
    false,
  );
  assert.equal(
    isPreviewableImage({ url: `${BLOB}/id-logo.svg`, name: "logo.svg" }),
    false,
  );
});

test("a query string or fragment does not hide the extension", () => {
  assert.equal(
    isPreviewableImage({ url: `${BLOB}/id-site.png?download=1`, name: "" }),
    true,
  );
  assert.equal(
    isPreviewableImage({ url: `${BLOB}/id-site.png#page=2`, name: "" }),
    true,
  );
});

test("a document opens in the document viewer, alone", () => {
  const files = [
    { url: `${BLOB}/1-a.png`, name: "a.png" },
    { url: `${BLOB}/2-survey.pdf`, name: "survey.pdf" },
    { url: `${BLOB}/3-b.png`, name: "b.png" },
  ];

  assert.deepEqual(filePreviewModal(files, 1), {
    type: "previewFile",
    payload: { fileUrl: `${BLOB}/2-survey.pdf` },
  });
});

test("an image opens as a gallery with itself first", () => {
  const files = [
    { url: `${BLOB}/1-a.png`, name: "a.png" },
    { url: `${BLOB}/2-survey.pdf`, name: "survey.pdf" },
    { url: `${BLOB}/3-b.png`, name: "b.png" },
    { url: `${BLOB}/4-c.jpg`, name: "c.jpg" },
  ];

  // Clicking the third row: it leads, the other images follow in list order,
  // and the PDF between them is not in the gallery at all.
  assert.deepEqual(filePreviewModal(files, 2), {
    type: "viewPicture",
    payload: {
      imageUrls: [`${BLOB}/3-b.png`, `${BLOB}/1-a.png`, `${BLOB}/4-c.jpg`],
      selectedIndex: 0,
    },
  });
});

test("the selected image is never duplicated in its own gallery", () => {
  const files = [
    { url: `${BLOB}/1-a.png`, name: "a.png" },
    { url: `${BLOB}/2-b.png`, name: "b.png" },
  ];

  const action = filePreviewModal(files, 0);
  assert.equal(action?.type, "viewPicture");
  const { imageUrls } = (
    action as Extract<typeof action, { type: "viewPicture" }>
  ).payload;
  assert.deepEqual(imageUrls, [`${BLOB}/1-a.png`, `${BLOB}/2-b.png`]);
  assert.equal(new Set(imageUrls).size, imageUrls.length);
});

test("a lone image still opens as a one-picture gallery", () => {
  const files = [
    { url: `${BLOB}/1-survey.pdf`, name: "survey.pdf" },
    { url: `${BLOB}/2-a.png`, name: "a.png" },
  ];

  assert.deepEqual(filePreviewModal(files, 1), {
    type: "viewPicture",
    payload: { imageUrls: [`${BLOB}/2-a.png`], selectedIndex: 0 },
  });
});

test("an index naming no file yields no modal", () => {
  const files = [{ url: `${BLOB}/1-a.png`, name: "a.png" }];
  // findIndex returning -1 is the real caller shape worth covering: a row whose
  // file is not in the pool must open nothing rather than throw.
  assert.equal(filePreviewModal(files, -1), null);
  assert.equal(filePreviewModal(files, 5), null);
  assert.equal(filePreviewModal([], 0), null);
});
