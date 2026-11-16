import { isBlobStoreUrl } from "@/lib/blob-url";

import { DomainValidationError } from "../errors";
import type { ProjectSourceDocuments } from "./creation";

/**
 * Refuse a project whose tender or contract reference points anywhere but this
 * deployment's own Blob store (#284).
 *
 * The create-project schema only checks that `url` parses as a URL, and
 * `createProjectFromOffer` reaches the writer without the schema at all, so the
 * check lives with the writer, where every caller passes. It pins the store, not
 * the host family: `isBlobStorageUrl` accepts every Vercel Blob account, so
 * anyone with a free one could host a file that passed it. The store id comes
 * from the caller because the domain does not read the environment; a missing
 * or malformed token gives `null`, and `isBlobStoreUrl` then refuses everything,
 * which is the safe way to fail.
 */
export function assertSourceDocumentsInStore(
  documents: ProjectSourceDocuments,
  storeId: string | null,
): void {
  for (const kind of ["tender", "contract"] as const) {
    if (!isBlobStoreUrl(documents[kind].url, storeId)) {
      throw new DomainValidationError(
        `The ${kind} document must be a file uploaded to this app.`,
        "sourceDocuments",
      );
    }
  }
}
