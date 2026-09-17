import { isBlobStorageUrl } from "../blob-url";

// Where an offer image is allowed to live.
//
// The customer PDF renderers put an image's URL straight into an <img src>, and
// the headless browser that prints the PDF fetches it from inside our network.
// The URL comes from the workspace snapshot, which a Server Action accepts from
// the client, so without a check a hand-built save could point a slot at an
// internal address (http://169.254.169.254/…) and have the renderer fetch it.
//
// Every legitimate image path — the upload button, the Dropbox import and the AI
// generator — ends in a public Vercel Blob put(), so Royal's Blob storage is the
// whole allowlist. Royal's own store, not the domain: every Vercel Blob tenant
// is a subdomain of the same domain, so allowing the suffix alone would allow
// any stranger's store, and a hand-built save could then put a third party's
// image — swapped out at any time, by someone we don't control — into a
// customer's offer PDF.
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

// Royal's store, matching the Blob assets we already ship (RC_URLS_APP in
// lib/graph/Email/email-theme.ts). This constant, not the token below, is what
// answers wherever the token can't be read: at build time, in tests, and in the
// browser — this module travels with the workspace persistence code into the
// offer workspace client bundle, where a non-NEXT_PUBLIC_ env var is undefined.
export const ROYAL_BLOB_HOST = `udafiztdzg1cn8u2${BLOB_HOST_SUFFIX}`;

const BLOB_RW_TOKEN_PREFIX = "vercel_blob_rw_";

// A Vercel Blob read-write token reads vercel_blob_rw_<storeId>_<secret>, and a
// store is served from <storeId>.public.blob.vercel-storage.com. Deriving the
// host from the very token that writes these images keeps the allowlist and the
// store from drifting apart if the store is ever replaced.
function hostFromBlobToken(token: string | undefined): string | null {
  if (!token?.startsWith(BLOB_RW_TOKEN_PREFIX)) {
    return null;
  }
  const storeId = token.slice(BLOB_RW_TOKEN_PREFIX.length).split("_")[0];
  if (!/^[a-z0-9]+$/i.test(storeId)) {
    return null;
  }
  return `${storeId.toLowerCase()}${BLOB_HOST_SUFFIX}`;
}

export function allowedOfferImageHost(): string {
  return hostFromBlobToken(process.env.BLOB_READ_WRITE_TOKEN) ?? ROYAL_BLOB_HOST;
}

export function isAllowedOfferImageUrl(url: unknown): boolean {
  if (typeof url !== "string") {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.hostname.toLowerCase() === allowedOfferImageHost()
  );
}
