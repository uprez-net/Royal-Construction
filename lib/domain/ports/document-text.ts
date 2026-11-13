/**
 * Read the text out of an uploaded document for the agent's context index.
 *
 * A port because the readers (Mistral OCR, a spreadsheet parser, a fetch) are
 * SDKs and network calls the domain may not import. The contract the index
 * relies on:
 *
 * - `text`: one string per page, in order (a worksheet counts as a page). An
 *   empty page stays in the list, so page numbers stay true.
 * - `unsupported`: the document is a kind this reader does not read (a video,
 *   a zip, a CAD file) or is too large. It is not retried until it changes.
 * - `unavailable`: the reader cannot read anything of this kind right now (its
 *   key is not configured). Nothing is recorded against the document, so it is
 *   read as soon as the reader is back, however long that takes.
 * - A thrown error is a failure to read: the index records it and tries again
 *   on a later run, a bounded number of times.
 */
export type DocumentTextPort = {
  readonly extract: (document: {
    readonly url: string;
    readonly filename: string;
    readonly mediaType: string;
    readonly sizeBytes: number | null;
  }) => Promise<DocumentText>;
};

export type DocumentText =
  | { readonly status: "text"; readonly pages: readonly string[] }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };
