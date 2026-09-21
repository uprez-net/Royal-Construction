// Blob storage as a capability the domain is handed, not a package it imports.
//
// Every one of these effects was previously split: a domain command decided
// whether a URL was in scope, returned it, and an adapter called `del` on the
// answer. That leaves the decision and the effect in different files, and the
// only thing joining them is the adapter remembering to act on what it was
// told. Passing the capability in keeps the whole effect in the command that
// authorized it, and lets a test prove the delete did not happen when the
// rule refused.
//
// `@vercel/blob` is Node-clean, so this is not a `eve build` constraint — it is
// the issue #301 gate: every external side effect has an explicit port.

/**
 * Remove stored objects. Implementations must be idempotent on a miss: every
 * caller here is reclaiming storage behind a database write that has already
 * committed, so an object that is already gone is the desired end state, not
 * an error.
 *
 * Takes a list as well as one url because the compliance reclamation decides
 * about a whole replacement at once and a single round trip is the point.
 */
export type BlobDeletePort = (
  blobUrl: string | readonly string[],
) => Promise<void>;

/** Store one object and answer where it landed. */
export type BlobPutPort = (input: {
  readonly pathname: string;
  readonly body: ArrayBuffer | Buffer | Uint8Array | string;
  readonly contentType?: string;
  /** Overwrite rather than orphan when the path already identifies the object. */
  readonly allowOverwrite?: boolean;
}) => Promise<{ url: string }>;

/**
 * A no-op delete, for a caller that has authorized an effect it is not yet
 * ready to perform. Named rather than an inline `async () => {}` so it reads
 * as a deliberate choice in a call site and greps as one.
 */
export const noopBlobDelete: BlobDeletePort = async () => {};
