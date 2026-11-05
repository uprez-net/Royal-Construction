import assert from "node:assert/strict";
import { test } from "vitest";

import { readCapped } from "@/lib/comms/http";
import { isCommsError } from "@/lib/domain/ports/comms";
import { readBoundedBody } from "@/lib/http/bounded-body";

// A chunked body that counts how much of it was pulled, and notices when the
// reader gives up on it.
function chunkedBody(chunks: number, chunkSize: number) {
  const seen = { cancelled: false, pulled: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      cancel() {
        seen.cancelled = true;
      },
      pull(controller) {
        if (seen.pulled >= chunks) {
          controller.close();
          return;
        }
        seen.pulled += 1;
        controller.enqueue(new Uint8Array(chunkSize));
      },
    },
    { highWaterMark: 0 },
  );
  return { seen, stream };
}

test("a chunked body with no content-length stops as soon as it passes the limit", async () => {
  const { seen, stream } = chunkedBody(1_000, 1_024);
  const bytes = await readBoundedBody(new Response(stream), 4_096);
  assert.equal(bytes, null);
  assert.equal(seen.cancelled, true, "the download was cancelled");
  assert.ok(
    seen.pulled <= 6,
    `only a few chunks past the limit were read, not all 1000 (read ${seen.pulled})`,
  );
});

test("a content-length that understates the body does not let it through", async () => {
  const { seen, stream } = chunkedBody(1_000, 1_024);
  const response = new Response(stream, {
    headers: { "content-length": "10" },
  });
  assert.equal(await readBoundedBody(response, 4_096), null);
  assert.equal(seen.cancelled, true);
  assert.ok(seen.pulled <= 6);
});

test("a declared content-length over the limit is refused without reading", async () => {
  const { seen, stream } = chunkedBody(10, 1_024);
  const response = new Response(stream, {
    headers: { "content-length": "999999" },
  });
  assert.equal(await readBoundedBody(response, 4_096), null);
  assert.equal(seen.pulled, 0);
});

test("a body within the limit comes back whole", async () => {
  const { stream } = chunkedBody(3, 1_000);
  const bytes = await readBoundedBody(new Response(stream), 4_096);
  assert.equal(bytes?.byteLength, 3_000);
  assert.equal(
    (await readBoundedBody(new Response(new Uint8Array([1, 2, 3])), 3))
      ?.byteLength,
    3,
  );
});

test("a recording download that keeps going past the limit is a definite refusal", async () => {
  const { seen, stream } = chunkedBody(1_000, 1_024);
  await assert.rejects(
    readCapped(new Response(stream), 4_096, "TWILIO"),
    (error: unknown) =>
      isCommsError(error)
      && error.kind === "rejected"
      && error.providerCode === "TWILIO_TOO_LARGE",
  );
  assert.equal(seen.cancelled, true);
});
