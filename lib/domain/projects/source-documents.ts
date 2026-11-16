import { isBlobStoreUrl } from "@/lib/blob-url";

import { DomainValidationError } from "../errors";
import type { CreateProjectFromLeadInput } from "./creation";

/**
 * Refuse a project whose tender or contract reference points anywhere but this
 * deployment's own Blob store (#284).
 *
 * `createProjectFromLead` is the one command every caller reaches (the wizard's
 * action, the offer handoff and Eve), so the check lives there. The create-
 * project schema only checks that `url` parses, and the handoff and Eve skip it
 * entirely. It pins the store, not the host family: `isBlobStorageUrl` accepts
 * every Vercel Blob account, so anyone with a free one could host a file that
 * passed it. The store id comes from the adapter because the domain does not
 * read the environment; a missing or malformed token gives `null`, and
 * `isBlobStoreUrl` then refuses everything, the safe way to fail.
 *
 * Both places the references can arrive are checked: the top-level
 * `sourceDocuments` and the copy a nested requirements payload carries, which
 * the command stores unchanged.
 */
export function assertProjectDocumentsInStore(
  input: Pick<CreateProjectFromLeadInput, "extraction" | "sourceDocuments">,
  storeId: string | null,
): void {
  const refuse = (kind: string) => {
    throw new DomainValidationError(
      `The ${kind} document must be a file uploaded to this app.`,
      "sourceDocuments",
    );
  };

  for (const kind of ["tender", "contract"] as const) {
    if (!isBlobStoreUrl(input.sourceDocuments[kind].url, storeId)) {
      refuse(kind);
    }
  }

  const nested = (input.extraction as { sourceDocuments?: unknown } | null)
    ?.sourceDocuments as
    | Record<string, { url?: unknown } | null | undefined>
    | undefined
    | null;
  if (nested && typeof nested === "object") {
    for (const kind of ["tender", "contract"] as const) {
      const url = nested[kind]?.url;
      if (url !== undefined && url !== null && !isBlobStoreUrl(url, storeId)) {
        refuse(kind);
      }
    }
  }
}
