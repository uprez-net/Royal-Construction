// The address a screen uses to open a stored file (#571).
//
// Every file this app stores is private: the URL a row holds answers 403 to a
// browser. `/api/files/signed-url` checks the signed-in caller against the
// same rule as the page and redirects to a fifteen-minute read-only link, so a
// link or an image only has to point there instead. A public URL (a row from
// before the move, a brand asset) and anything that is not Blob at all are
// returned unchanged.
//
// Browser-safe: no token, no server import. Keep the stored URL for anything
// that is not fetching — a file's name, its extension, a save payload — and
// wrap only where the browser loads it.

import { isPrivateBlobUrl } from "@/lib/blob-url";

export const SIGNED_FILE_ROUTE = "/api/files/signed-url";

export function fileHref(url: string): string;
export function fileHref(url: string | null | undefined): string | undefined;
export function fileHref(url: string | null | undefined): string | undefined {
  if (!url) return url ?? undefined;
  if (!isPrivateBlobUrl(url)) return url;
  return `${SIGNED_FILE_ROUTE}?${new URLSearchParams({ redirect: "1", url })}`;
}

/**
 * Props for a `next/image` showing a stored file. A private one is loaded
 * through the signing route without the optimiser: the optimiser fetches
 * server-side with no session, and the signed link it would cache expires.
 */
export function storedImageProps(url: string): {
  src: string;
  unoptimized: boolean;
} {
  return { src: fileHref(url), unoptimized: isPrivateBlobUrl(url) };
}
