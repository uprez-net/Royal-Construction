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
// generator — ends in a public Vercel Blob put(), so Blob storage is the whole
// allowlist. The host rule itself lives in lib/blob-url.ts, shared with the
// tender/contract extraction.
export function isAllowedOfferImageUrl(url: unknown): boolean {
  return isBlobStorageUrl(url);
}
