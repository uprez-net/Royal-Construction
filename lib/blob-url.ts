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
