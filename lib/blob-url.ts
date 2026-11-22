// Whether a URL points into Vercel Blob storage, where every file this app
// uploads ends up.
//
// Used wherever a client-supplied URL is later fetched by something that runs
// with our network access or spends money on the result: the customer PDF
// renderers (offer images) and the tender/contract OCR run. Without it a
// hand-built request could point either at an internal address
// (http://169.254.169.254/…) or at any document on the internet.
//
// Both access modes are Blob: a store created public serves
// <storeId>.public.blob.vercel-storage.com, one created private serves
// <storeId>.private.blob.vercel-storage.com. Royal's files moved from the first
// to the second (#571); a row written before that still holds a public URL.
const BLOB_HOST_PATTERN =
  /^([a-z0-9-]+)\.(public|private)\.blob\.vercel-storage\.com$/;

export type BlobAccess = "public" | "private";

/** A Blob URL taken apart: which store, which access mode, which object. */
export type ParsedBlobUrl = {
  readonly storeId: string;
  readonly access: BlobAccess;
  /** The object's pathname as the store knows it, percent-decoded. */
  readonly pathname: string;
};

export function parseBlobUrl(url: unknown): ParsedBlobUrl | null {
  if (typeof url !== "string") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
  ) {
    return null;
  }
  const host = BLOB_HOST_PATTERN.exec(parsed.hostname.toLowerCase());
  if (!host) {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
  if (!pathname) {
    return null;
  }
  return {
    storeId: host[1]!,
    access: host[2] as BlobAccess,
    pathname,
  };
}

export function isBlobStorageUrl(url: unknown): boolean {
  return parseBlobUrl(url) !== null;
}

/** A stored object that only a signed or token-authorised request can read. */
export function isPrivateBlobUrl(url: unknown): boolean {
  return parseBlobUrl(url)?.access === "private";
}

const BLOB_RW_TOKEN_PREFIX = "vercel_blob_rw_";

// The store a Vercel Blob read-write token writes to, read the way
// @vercel/blob reads it: vercel_blob_rw_<storeId>_<secret>. Null when the
// token is missing or malformed.
//
// The prefix is checked rather than just counting "_" fields: without it any
// four-field string parsed as a token, so a misconfigured BLOB_READ_WRITE_TOKEN
// would silently yield a store id and pin the allowlist to a store we do not
// own. Fails closed instead, the same way hostFromBlobToken does in
// lib/offer/offer-image-url.ts.
export function blobStoreIdFromToken(
  token: string | null | undefined,
): string | null {
  if (typeof token !== "string") {
    return null;
  }
  const trimmed = token.trim();
  if (!trimmed.startsWith(BLOB_RW_TOKEN_PREFIX)) {
    return null;
  }
  const storeId =
    trimmed.slice(BLOB_RW_TOKEN_PREFIX.length).split("_")[0] ?? "";
  return /^[a-z0-9-]+$/i.test(storeId) ? storeId.toLowerCase() : null;
}

// Whether a URL is a file in one particular Blob store, public or private.
//
// isBlobStorageUrl accepts every Vercel Blob store, so anyone with a free
// account can host a file that passes it. Server code that only takes files
// this deployment uploaded pins the store instead, passing the id from
// BLOB_READ_WRITE_TOKEN. The offer image rule cannot: it also runs in the
// browser, where there is no token.
export function isBlobStoreUrl(
  url: unknown,
  storeId: string | null | undefined,
): boolean {
  if (!storeId) {
    return false;
  }
  return parseBlobUrl(url)?.storeId === storeId.toLowerCase();
}
