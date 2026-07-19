"use server";

import { auth } from "@clerk/nextjs/server";
import { head, put } from "@vercel/blob";
import { createHash } from "node:crypto";

const MAX_IMAGE_BYTES = 40 * 1024 * 1024; // 40MB, matches upload constraints

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type ImportResult =
  | { ok: true; url: string; deduped: boolean }
  | { ok: false; error: string };

// Copy a Dropbox-chosen image into our own Blob storage. Content is keyed by
// its SHA-256 so the same photo (e.g. a reused finished-home shot) is stored
// exactly once and every offer references the same URL — no redundancy.
export async function importDropboxImage(input: {
  url: string;
  fileName: string;
}): Promise<ImportResult> {
  const { isAuthenticated } = await auth();
  if (!isAuthenticated) {
    return { ok: false, error: "Unauthorized" };
  }

  try {
    const response = await fetch(input.url);
    if (!response.ok) {
      return { ok: false, error: `Could not fetch file (${response.status})` };
    }
    const contentType = (
      response.headers.get("content-type") ?? "image/jpeg"
    ).split(";")[0];
    if (!contentType.startsWith("image/")) {
      return { ok: false, error: "Selected file is not an image" };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, error: "Image exceeds the 40MB limit" };
    }

    const hash = createHash("sha256").update(buffer).digest("hex");
    const extension =
      EXT_BY_CONTENT_TYPE[contentType] ?? extensionFromName(input.fileName);
    const pathname = `offer-gallery/${hash}.${extension}`;

    // De-dupe: identical content already imported -> reuse it.
    try {
      const existing = await head(pathname);
      if (existing?.url) {
        return { ok: true, url: existing.url, deduped: true };
      }
    } catch {
      // Not found — fall through and upload.
    }

    const blob = await put(pathname, buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return { ok: true, url: blob.url, deduped: false };
  } catch (error) {
    return { ok: false, error: (error as Error).message || "Import failed" };
  }
}

function extensionFromName(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "jpg";
}
