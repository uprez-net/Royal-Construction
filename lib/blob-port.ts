import { del } from "@/lib/blob";

import type { BlobDeletePort } from "@/lib/domain/ports/blob";

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
