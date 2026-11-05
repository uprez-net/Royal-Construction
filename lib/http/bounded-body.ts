/**
 * Read a response (or request) body, stopping as soon as it passes `maxBytes`.
 *
 * `Content-Length` is checked first as a fast refusal, but it can be missing
 * (chunked) or wrong, so the stream is counted as it arrives and cancelled the
 * moment it goes over. A file that is too big is never held in memory.
 * Returns null when the body is larger than `maxBytes`.
 */
export async function readBoundedBody(
  response: Pick<Response, "headers" | "body">,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Cancelling the stream aborts the rest of the download.
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
