import { del, get, issueSignedToken, presignUrl, put } from "@/lib/blob";
import { blobStoreIdFromToken, parseBlobUrl } from "@/lib/blob-url";

import type { BlobDeletePort, BlobPutPort } from "@/lib/domain/ports/blob";

/**
 * The one Vercel Blob implementation of the domain's delete capability.
 *
 * Written once rather than inline at each call site so that "how this app
 * talks to blob storage" is a single answer, and so swapping the provider is
 * an edit here instead of a search. `del` already treats a missing object as
 * success, which is the idempotence the port asks for.
 */
export const vercelBlobDelete: BlobDeletePort = async (blobUrl) => {
  await del(Array.isArray(blobUrl) ? [...blobUrl] : (blobUrl as string));
};

/**
 * The Vercel Blob implementation of the domain's put capability, for callers
 * whose path already identifies the object (so `allowOverwrite` makes a
 * replayed write land on the same object instead of orphaning a copy).
 *
 * Private (#571): the main store (BLOB_READ_WRITE_TOKEN) is a private store,
 * so a stored URL on its own opens nothing. A browser reaches a file through
 * `/api/files/signed-url`, server code through `fetchStoredFile` or
 * `signedBlobReadUrl` below.
 */
export const vercelBlobPut: BlobPutPort = async (input) => {
  const body =
    typeof input.body === "string"
      ? input.body
      : Buffer.from(input.body as ArrayBuffer);
  const stored = await put(input.pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: input.allowOverwrite ?? false,
    contentType: input.contentType,
  });
  return { url: stored.url };
};

/**
 * The read-write token of the recordings store, or null if none is set up.
 *
 * Call recordings were the first private files, and went to a store of their
 * own before the main store was private too. Production may still hold
 * recordings there, so its token is still honoured for both writing and
 * reading; unset, recordings go to the main store like every other file.
 */
function privateBlobToken(): string | null {
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim();
  return token ? token : null;
}

function mainBlobToken(): string | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? token : null;
}

/**
 * The token that can read objects in this store, or null if it is not one of
 * ours. Chosen by the store id in the URL rather than by which feature wrote
 * the file, so a recording in the main store and one in the recordings store
 * both read.
 */
function tokenForStore(storeId: string): string | null {
  for (const token of [mainBlobToken(), privateBlobToken()]) {
    if (token && blobStoreIdFromToken(token) === storeId) return token;
  }
  return null;
}

/**
 * Put for call recordings: the recordings store when one is configured
 * (BLOB_PRIVATE_READ_WRITE_TOKEN), the main store otherwise. Private either
 * way, and only ever read through `readStoredBlob` in an authenticated route.
 */
export const vercelRecordingBlobPut: BlobPutPort = async (input) => {
  const token = privateBlobToken();
  if (!token) return vercelBlobPut(input);
  const body =
    typeof input.body === "string"
      ? input.body
      : Buffer.from(input.body as ArrayBuffer);
  const stored = await put(input.pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: input.allowOverwrite ?? false,
    contentType: input.contentType,
    token,
  });
  return { url: stored.url };
};

/** How long a signed read URL lasts. Long enough to open, short enough to leak. */
export const SIGNED_READ_TTL_MS = 15 * 60 * 1_000;

/**
 * How long one store-wide delegation is used for before a fresh one is asked
 * for. Every signed URL is capped at its delegation's expiry, so a delegation
 * is replaced while it still has at least a full signed-URL lifetime left.
 */
const DELEGATION_TTL_MS = 60 * 60 * 1_000;

type Delegation = {
  readonly delegationToken: string;
  readonly clientSigningToken: string;
  readonly validUntil: number;
};

// One get-only delegation per store, shared by every URL signed in this
// process. Issuing one is an API call; signing with it is a local HMAC, so a
// page of fifty photos costs one round trip rather than fifty. The delegation
// is scoped to `get` alone and never leaves the server: a signed URL carries
// it, but without the client signing token it cannot sign another path.
const delegations = new Map<string, Promise<Delegation>>();

async function delegationFor(
  storeId: string,
  token: string,
): Promise<Delegation> {
  const cached = delegations.get(storeId);
  if (cached) {
    const delegation = await cached;
    if (delegation.validUntil - Date.now() > SIGNED_READ_TTL_MS + 60_000) {
      return delegation;
    }
  }
  return issueDelegation(storeId, token);
}

function issueDelegation(storeId: string, token: string): Promise<Delegation> {
  const issued = issueSignedToken({
    operations: ["get"],
    pathname: "*",
    token,
    validUntil: Date.now() + DELEGATION_TTL_MS,
  }).then((result) => ({
    clientSigningToken: result.clientSigningToken,
    delegationToken: result.delegationToken,
    validUntil: result.validUntil,
  }));
  delegations.set(storeId, issued);
  // A failed issue is not cached: the next request asks again.
  issued.catch(() => {
    if (delegations.get(storeId) === issued) delegations.delete(storeId);
  });
  return issued;
}

/** Forget cached delegations. For tests. */
export function resetBlobDelegationsForTests(): void {
  delegations.clear();
}

/**
 * Whether a URL is a file this app can hand out: a private object in a store
 * we hold the token for, or a public Blob object (a row from before #571),
 * which is readable already.
 */
export function isStoredBlobUrl(url: string): boolean {
  const parsed = parseBlobUrl(url);
  if (!parsed) return false;
  return parsed.access === "public" || tokenForStore(parsed.storeId) !== null;
}

export type SignedBlobRead = {
  readonly url: string;
  /** When the URL stops opening, in ms since the epoch. Null: it never does. */
  readonly expiresAt: number | null;
};

/**
 * A URL that reads one stored object without any other credential, for a
 * browser, a headless renderer or an outside service (OCR, WhatsApp) to fetch.
 *
 * A private object gets a read-only signed URL that expires after
 * `SIGNED_READ_TTL_MS`. A public object (a row written before #571, or a
 * brand asset) is already readable and comes back unchanged. A URL that is not
 * Blob at all also comes back unchanged: deciding whether to fetch it is the
 * caller's rule, not this one's.
 *
 * Throws for a private object in a store this deployment has no token for.
 * Authorisation is NOT checked here; a route that signs for a browser asks
 * `authorizeStoredFileRead` first.
 */
export async function signedBlobReadUrl(
  url: string,
  options: { readonly ttlMs?: number } = {},
): Promise<SignedBlobRead> {
  const parsed = parseBlobUrl(url);
  if (!parsed || parsed.access === "public") {
    return { expiresAt: null, url };
  }
  const token = tokenForStore(parsed.storeId);
  if (!token) {
    throw new Error(
      `No Blob token is configured for store ${parsed.storeId}, so its file can't be read.`,
    );
  }
  const delegation = await delegationFor(parsed.storeId, token);
  const expiresAt = Math.min(
    Date.now() + (options.ttlMs ?? SIGNED_READ_TTL_MS),
    delegation.validUntil,
  );
  const { presignedUrl } = await presignUrl(delegation, {
    access: "private",
    operation: "get",
    pathname: parsed.pathname,
    validUntil: expiresAt,
  });
  return { expiresAt, url: presignedUrl };
}

/**
 * `fetch` for a stored file, public or private.
 *
 * The drop-in for `fetch(file.url)` in server code: a private object is
 * fetched through a short-lived signed URL, anything else exactly as before.
 * The caller still checks `response.ok`.
 */
export async function fetchStoredFile(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const { url: readable } = await signedBlobReadUrl(url, { ttlMs: 5 * 60_000 });
  return fetch(readable, { cache: "no-store", ...init });
}

/**
 * A private Blob URL in HTML or CSS text. Parentheses are allowed, because a
 * pathname can carry them (`site(1).jpg`); `endOfUrl` then gives back a `)`
 * that closes a CSS `url(...)` rather than belonging to the path. Quotes,
 * whitespace, `<`, `>`, `;` and `\` end it: the attribute, tag or declaration
 * it sits in.
 */
const PRIVATE_BLOB_URL_IN_TEXT =
  /https:\/\/[a-z0-9-]+\.private\.blob\.vercel-storage\.com\/[^\s"'<>;\\]+/gi;

/** Trim the unbalanced closing parentheses a match swallowed from `url(...)`. */
function endOfUrl(match: string): string {
  let url = match;
  const count = (char: string) => url.split(char).length - 1;
  while (url.endsWith(")") && count(")") > count("(")) url = url.slice(0, -1);
  return url;
}

/**
 * Sign every private Blob URL in an HTML document, for a headless renderer
 * that fetches images itself and has no session. `&` in the signed query is
 * escaped, because the URLs sit in attributes.
 *
 * Throws if any of them cannot be signed. The document is a client's tender,
 * proposal or variation: one rendered with an image missing would go out
 * looking finished, and nobody would see it was wrong until the client did.
 * The callers already turn a render failure into a refusal the office reads.
 */
export async function signBlobUrlsInHtml(html: string): Promise<string> {
  const found = [
    ...new Set((html.match(PRIVATE_BLOB_URL_IN_TEXT) ?? []).map(endOfUrl)),
  ];
  if (found.length === 0) return html;
  const signed = new Map<string, string>();
  const results = await Promise.allSettled(
    found.map(async (url) => {
      const { url: readable } = await signedBlobReadUrl(url);
      signed.set(url, readable.replaceAll("&", "&amp;"));
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    // The count only: a pathname can carry a client's name.
    throw new Error(
      `${failures.length} of ${found.length} stored image(s) in the document could not be signed for rendering.`,
      { cause: (failures[0] as PromiseRejectedResult).reason },
    );
  }
  return html.replace(PRIVATE_BLOB_URL_IN_TEXT, (match) => {
    const url = endOfUrl(match);
    return `${signed.get(url) ?? url}${match.slice(url.length)}`;
  });
}

/**
 * Open a stored object for streaming from the server, public or private.
 * `range` is passed through so an audio player can seek. Null on a miss.
 */
export async function readStoredBlob(
  url: string,
  options: { readonly range?: string | null } = {},
): Promise<{
  readonly stream: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly contentLength: string | null;
  /** Set when a range was asked for and served (a 206). */
  readonly contentRange: string | null;
  readonly etag: string | null;
} | null> {
  const parsed = parseBlobUrl(url);
  if (parsed?.access !== "private") {
    // A public object is a plain CDN read. The SDK's get() adds the store
    // token and a cache-busting query to it, which the CDN answers with 400.
    const response = await fetch(url, {
      cache: "no-store",
      ...(options.range ? { headers: { range: options.range } } : {}),
    });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) {
      throw new Error(
        `Reading a stored object failed (HTTP ${response.status}).`,
      );
    }
    return {
      contentLength: response.headers.get("content-length"),
      contentRange: response.headers.get("content-range"),
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      etag: response.headers.get("etag"),
      stream: response.body,
    };
  }
  const token = tokenForStore(parsed.storeId);
  if (!token) {
    throw new Error(
      `No Blob token is configured for store ${parsed.storeId}, so its file can't be read.`,
    );
  }
  const result = await get(url, {
    access: "private",
    token,
    ...(options.range ? { headers: { range: options.range } } : {}),
    useCache: false,
  });
  if (!result || result.statusCode !== 200) return null;
  return {
    contentLength: result.headers.get("content-length"),
    contentRange: result.headers.get("content-range"),
    contentType: result.blob.contentType,
    etag: result.headers.get("etag"),
    stream: result.stream,
  };
}
