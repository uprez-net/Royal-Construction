import { afterEach, beforeEach } from "vitest";

// The offer image allowlist follows the store named by the Blob tokens, and
// with no token it accepts any private Blob URL (lib/offer/offer-image-url.ts).
// A test that only reads process.env therefore passes or fails depending on
// where it runs: locally there is no token, while CI has the real
// BLOB_READ_WRITE_TOKEN secret, which names a different store. Pin the tokens
// so every run takes the server path, the one that guards the PDF renderer.

export const TEST_BLOB_STORE = "royalstore01";

const KEYS = [
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_PRIVATE_READ_WRITE_TOKEN",
] as const;

/** For every test in the calling file, Royal's Blob store is TEST_BLOB_STORE. */
export function pinBlobStoreTokens(): void {
  // process.env is typed with the app's keys required; one is deleted here.
  const env = process.env as Record<string, string | undefined>;
  const saved = KEYS.map((key) => [key, env[key]] as const);

  beforeEach(() => {
    env.BLOB_READ_WRITE_TOKEN = `vercel_blob_rw_${TEST_BLOB_STORE}_secret`;
    delete env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });
}
