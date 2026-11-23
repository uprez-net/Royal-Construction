// Where an offer image is allowed to live.
//
// The customer PDF renderers put an image's URL straight into an <img src>, and
// the headless browser that prints the PDF fetches it from inside our network.
// The URL comes from the workspace snapshot, which a Server Action accepts from
// the client, so without a check a hand-built save could point a slot at an
// internal address (http://169.254.169.254/…) and have the renderer fetch it.
//
// Every legitimate image path — the upload button, the Dropbox import and the AI
// generator — ends in a private Vercel Blob put() (#571), so Royal's Blob store
// is the whole allowlist. Royal's own store, not the domain: every Vercel Blob
// tenant is a subdomain of the same domain, so allowing the suffix alone would
// allow any stranger's store, and a hand-built save could then put a third
// party's image — swapped out at any time, by someone we don't control — into a
// customer's offer PDF.
//
// The public stores the images lived in before #571 are no longer allowed:
// both environments were migrated and their old objects deleted on 2026-11-23,
// so nothing names them any more.
import {
  blobStoreIdFromToken,
  isBlobStoreUrl,
  isPrivateBlobUrl,
} from "@/lib/blob-url";

/**
 * The stores an offer image may be in, where the tokens can be read: the main
 * store, and the recordings store if one is configured. Derived from the very
 * tokens that write the images, so the allowlist follows a replaced store.
 */
export function allowedOfferImageStores(): readonly string[] {
  return [
    process.env.BLOB_READ_WRITE_TOKEN,
    process.env.BLOB_PRIVATE_READ_WRITE_TOKEN,
  ]
    .map(blobStoreIdFromToken)
    .filter((storeId): storeId is string => storeId !== null);
}

export function isAllowedOfferImageUrl(url: unknown): boolean {
  const stores = allowedOfferImageStores();
  if (blobStoreIdFromToken(process.env.BLOB_READ_WRITE_TOKEN) !== null) {
    return stores.some((storeId) => isBlobStoreUrl(url, storeId));
  }
  // No token: the browser (this module travels with the workspace persistence
  // code into the offer workspace client bundle, where a non-NEXT_PUBLIC_ env
  // var is undefined), a build or a test. The store's id is not known here,
  // and dropping its images would empty the slots on the next autosave, so any
  // private Blob URL passes. That is safe because it is not the check that
  // guards the renderer: the server re-parses every save with the tokens in
  // hand, and a private object in a stranger's store cannot be read without
  // that stranger's token anyway.
  return isPrivateBlobUrl(url);
}
