import { del, get, put } from "@vercel/blob";

import type { BlobDeletePort, BlobPutPort } from "@/lib/domain/ports/blob";

/**
 * The one Vercel Blob implementation of the domain's delete capability.
 *
 * Written once rather than inline at each call site so that "how this app
 * talks to blob storage" is a single answer, and so swapping the provider is
 * an edit here instead of a search. `del` already treats a missing object as
 * success, which is the idempotence the port asks for.
 */
export const vercelBlobDelete: BlobDeletePort = async (blobUrl) => {
  await del(Array.isArray(blobUrl) ? [...blobUrl] : (blobUrl as string));
};

/**
 * The Vercel Blob implementation of the domain's put capability, for callers
 * whose path already identifies the object (so `allowOverwrite` makes a
 * replayed write land on the same object instead of orphaning a copy).
 */
export const vercelBlobPut: BlobPutPort = async (input) => {
  const body =
    typeof input.body === "string"
      ? input.body
      : Buffer.from(input.body as ArrayBuffer);
  const stored = await put(input.pathname, body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: input.allowOverwrite ?? false,
    contentType: input.contentType,
  });
  return { url: stored.url };
};

const PRIVATE_BLOB_HOST_SUFFIX = ".private.blob.vercel-storage.com";

/**
 * The read-write token of the private Blob store, or null if none is set up.
 *
 * Vercel fixes a store's access mode when the store is created, and the main
 * store (BLOB_READ_WRITE_TOKEN) is public. Private objects such as call
 * recordings need a second store, created as private, with its own token.
 */
function privateBlobToken(): string | null {
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim();
  return token ? token : null;
}

/**
 * Put for objects nobody should reach without signing in (call recordings).
 *
 * Writes only to the private store, and fails closed when none is configured:
 * a recording must never land in the public store. It stays at the carrier,
 * and the daily comms sweep tries again once the token is set. The stored URL
 * must only be read through `readStoredBlob` in an authenticated route, never
 * handed to a browser.
 */
export const vercelPrivateBlobPut: BlobPutPort = async (input) => {
  const token = privateBlobToken();
  if (!token) {
    throw new Error(
      "BLOB_PRIVATE_READ_WRITE_TOKEN is not set, so a private object can't be stored.",
    );
  }
  const body =
    typeof input.body === "string"
      ? input.body
      : Buffer.from(input.body as ArrayBuffer);
  const stored = await put(input.pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: input.allowOverwrite ?? false,
    contentType: input.contentType,
    token,
  });
  return { url: stored.url };
};

/**
 * Open a stored object for streaming from the server, public or private.
 * `range` is passed through so an audio player can seek. Null on a miss.
 */
export async function readStoredBlob(
  url: string,
  options: { readonly range?: string | null } = {},
): Promise<{
  readonly stream: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly contentLength: string | null;
  /** Set when a range was asked for and served (a 206). */
  readonly contentRange: string | null;
  readonly etag: string | null;
} | null> {
  const isPrivate = new URL(url).hostname
    .toLowerCase()
    .endsWith(PRIVATE_BLOB_HOST_SUFFIX);
  const token = isPrivate ? privateBlobToken() : undefined;
  if (isPrivate && !token) {
    throw new Error(
      "BLOB_PRIVATE_READ_WRITE_TOKEN is not set, so a private object can't be read.",
    );
  }
  const result = await get(url, {
    access: isPrivate ? "private" : "public",
    ...(token ? { token } : {}),
    ...(options.range ? { headers: { range: options.range } } : {}),
    useCache: false,
  });
  if (!result || result.statusCode !== 200) return null;
  return {
    contentLength: result.headers.get("content-length"),
    contentRange: result.headers.get("content-range"),
    contentType: result.blob.contentType,
    etag: result.headers.get("etag"),
    stream: result.stream,
  };
}
