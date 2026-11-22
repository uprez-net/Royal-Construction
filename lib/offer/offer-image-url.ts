// Where an offer image is allowed to live.
//
// The customer PDF renderers put an image's URL straight into an <img src>, and
// the headless browser that prints the PDF fetches it from inside our network.
// The URL comes from the workspace snapshot, which a Server Action accepts from
// the client, so without a check a hand-built save could point a slot at an
// internal address (http://169.254.169.254/…) and have the renderer fetch it.
//
// Every legitimate image path — the upload button, the Dropbox import and the AI
// generator — ends in a Vercel Blob put(), so Royal's Blob storage is the whole
// allowlist. Royal's own stores, not the domain: every Vercel Blob tenant is a
// subdomain of the same domain, so allowing the suffix alone would allow any
// stranger's store, and a hand-built save could then put a third party's
// image — swapped out at any time, by someone we don't control — into a
// customer's offer PDF.
import { blobStoreIdFromToken, parseBlobUrl } from "@/lib/blob-url";

const PUBLIC_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const PRIVATE_HOST_SUFFIX = ".private.blob.vercel-storage.com";

// The public store that holds the Blob assets we ship (RC_URLS_APP in
// lib/graph/Email/email-theme.ts) — staging's original store. Always allowed:
// it is ours, and in the browser, where no token can be read, it was the whole
// allowlist before #571.
export const ROYAL_BLOB_HOST = `udafiztdzg1cn8u2${PUBLIC_HOST_SUFFIX}`;

/**
 * The hosts an offer image may be on, where the store tokens can be read.
 *
 * A Vercel Blob read-write token reads vercel_blob_rw_<storeId>_<secret>, and
 * the store serves <storeId>.public… or <storeId>.private… depending on how it
 * was created. Deriving the hosts from the very tokens that write the images
 * keeps the allowlist and the store from drifting apart when a store is
 * replaced, as it was for #571.
 */
export function allowedOfferImageHosts(): ReadonlySet<string> {
  const hosts = new Set([ROYAL_BLOB_HOST]);
  for (const token of [
    process.env.BLOB_READ_WRITE_TOKEN,
    process.env.BLOB_PRIVATE_READ_WRITE_TOKEN,
  ]) {
    const storeId = blobStoreIdFromToken(token);
    if (storeId) {
      hosts.add(`${storeId}${PUBLIC_HOST_SUFFIX}`);
      hosts.add(`${storeId}${PRIVATE_HOST_SUFFIX}`);
    }
  }
  return hosts;
}

function storeTokensReadable(): boolean {
  return blobStoreIdFromToken(process.env.BLOB_READ_WRITE_TOKEN) !== null;
}

export function isAllowedOfferImageUrl(url: unknown): boolean {
  const parsed = parseBlobUrl(url);
  if (!parsed) {
    return false;
  }
  const host = new URL(url as string).hostname.toLowerCase();
  if (storeTokensReadable()) {
    return allowedOfferImageHosts().has(host);
  }
  // No token: the browser (this module travels with the workspace persistence
  // code into the offer workspace client bundle, where a non-NEXT_PUBLIC_ env
  // var is undefined), a build or a test. The private store's id is not known
  // here, and dropping its images would empty the slots on the next autosave,
  // so any private Blob host passes. That is safe because it is not the check
  // that guards the renderer: the server re-parses every save with the tokens
  // in hand, and a private object in a stranger's store cannot be read
  // without that stranger's token anyway.
  return host === ROYAL_BLOB_HOST || parsed.access === "private";
}
