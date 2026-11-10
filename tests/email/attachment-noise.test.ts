import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isSignatureNoise,
  type AttachmentNoiseInput,
} from "@/lib/domain/email/attachment-noise";

function attachment(
  overrides: Partial<AttachmentNoiseInput> = {},
): AttachmentNoiseInput {
  return {
    name: "plans.pdf",
    contentType: "application/pdf",
    size: 400 * 1024,
    isInline: false,
    contentId: null,
    ...overrides,
  };
}

test("a small inline file is noise whatever its type", () => {
  assert.equal(
    isSignatureNoise(
      attachment({
        name: "pixel.gif",
        contentType: "image/gif",
        size: 43,
        isInline: true,
      }),
    ),
    true,
  );
  assert.equal(
    isSignatureNoise(
      attachment({ name: "vcard.vcf", size: 2_000, isInline: true }),
    ),
    true,
  );
});

test("a signature banner over the old 40 KB cut is still noise", () => {
  assert.equal(
    isSignatureNoise(
      attachment({
        name: "banner.png",
        contentType: "image/png",
        size: 90 * 1024,
        isInline: true,
      }),
    ),
    true,
  );
});

test("an Outlook-embedded logo Graph reports as not inline is noise", () => {
  assert.equal(
    isSignatureNoise(
      attachment({
        name: "image001.png",
        contentType: "image/png",
        size: 60 * 1024,
      }),
    ),
    true,
  );
  assert.equal(
    isSignatureNoise(
      attachment({
        name: "Outlook-k3j2h1.jpg",
        contentType: "image/jpeg",
        size: 45 * 1024,
      }),
    ),
    true,
  );
  assert.equal(
    isSignatureNoise(
      attachment({
        name: "logo.png",
        contentType: "image/png",
        size: 70 * 1024,
        contentId: "logo@01DA",
      }),
    ),
    true,
  );
});

test("a pasted photo is kept even though it is embedded", () => {
  assert.equal(
    isSignatureNoise(
      attachment({
        name: "image003.jpg",
        contentType: "image/jpeg",
        size: 900 * 1024,
        isInline: true,
      }),
    ),
    false,
  );
});

test("an attached image with no sign of being embedded is kept", () => {
  assert.equal(
    isSignatureNoise(
      attachment({
        name: "site-photo.jpg",
        contentType: "image/jpeg",
        size: 80 * 1024,
      }),
    ),
    false,
  );
});

test("a document with a Content-ID is never noise", () => {
  // Apple Mail sets a Content-ID on ordinary attachments; only images are
  // read as embedded.
  assert.equal(
    isSignatureNoise(attachment({ size: 30 * 1024, contentId: "doc@apple" })),
    false,
  );
});
