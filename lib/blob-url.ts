// Whether a URL points into public Vercel Blob storage, where every file this
// app uploads ends up.
//
// Used wherever a client-supplied URL is later fetched by something that runs
// with our network access or spends money on the result: the customer PDF
// renderers (offer images) and the tender/contract OCR run. Without it a
// hand-built request could point either at an internal address
// (http://169.254.169.254/…) or at any document on the internet.
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function isBlobStorageUrl(url: unknown): boolean {
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
    parsed.hostname.toLowerCase().endsWith(BLOB_HOST_SUFFIX)
  );
}

// The store a Vercel Blob read-write token writes to, read the way
// @vercel/blob reads it: vercel_blob_rw_<storeId>_<secret>. Null when the
// token is missing or malformed.
export function blobStoreIdFromToken(token: string | null | undefined): string | null {
  if (typeof token !== "string") {
    return null;
  }
  const [, , , storeId = ""] = token.trim().split("_");
  return /^[a-z0-9-]+$/i.test(storeId) ? storeId.toLowerCase() : null;
}

// Whether a URL is a public file in one particular Blob store.
//
// isBlobStorageUrl accepts every Vercel Blob store, so anyone with a free
// account can host a file that passes it. Server code that only takes files
// this deployment uploaded pins the store instead, passing the id from
// BLOB_READ_WRITE_TOKEN. The offer image rule cannot: it also runs in the
// browser, where there is no token.
export function isBlobStoreUrl(url: unknown, storeId: string | null | undefined): boolean {
  if (!storeId || !isBlobStorageUrl(url)) {
    return false;
  }
  return new URL(url as string).hostname.toLowerCase() === `${storeId.toLowerCase()}${BLOB_HOST_SUFFIX}`;
}
