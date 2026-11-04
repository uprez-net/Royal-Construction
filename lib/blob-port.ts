import { del, put } from "@vercel/blob";

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
