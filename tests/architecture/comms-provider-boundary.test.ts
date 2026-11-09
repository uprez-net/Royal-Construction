import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

import { MAX_RECORDING_ATTEMPTS } from "@/lib/domain/comms/calls/recordings";

import { collectSourceFiles, ROOT } from "./module-graph";

// The provider-agnostic boundary (docs/twilio-plivo-comms/06 §2, test 13).
//
// Switching from Twilio to Telnyx is a setting only while every vendor detail
// stays behind its adapter. These checks fail the moment a carrier's SDK, API
// host or wire format leaks into shared code — which is how "swappable" quietly
// stops being true.

const repoPath = (file: string) => relative(ROOT, file).split("\\").join("/");
const sources = ["app", "lib", "components", "hooks", "agent", "utils"].flatMap(
  (dir) =>
    collectSourceFiles(join(ROOT, dir)).map((file) => ({
      path: repoPath(file),
      text: readFileSync(file, "utf8"),
    })),
);

function offenders(
  pattern: RegExp,
  allowed: (path: string) => boolean,
): string[] {
  return sources
    .filter((file) => pattern.test(file.text) && !allowed(file.path))
    .map((file) => file.path);
}

test("a carrier's browser SDK is imported only by its own dialer", () => {
  assert.deepEqual(
    offenders(
      /from ["']@twilio\/voice-sdk["']|import\(["']@twilio\/voice-sdk["']\)/,
      (path) => path === "components/comms/dialer/twilio-dialer.ts",
    ),
    [],
  );
  assert.deepEqual(
    offenders(
      /from ["']@telnyx\/webrtc["']|import\(["']@telnyx\/webrtc["']\)/,
      (path) => path === "components/comms/dialer/telnyx-dialer.ts",
    ),
    [],
  );
});

test("no server-side carrier SDK: the adapters speak HTTPS themselves", () => {
  assert.deepEqual(
    offenders(/from ["'](twilio|telnyx|plivo)["']/, () => false),
    [],
  );
});

test("carrier API hosts and signature headers appear only in their adapter", () => {
  assert.deepEqual(
    offenders(
      /api\.twilio\.com|x-twilio-signature/i,
      (path) =>
        path.startsWith("lib/comms/providers/twilio/")
        || path === "lib/comms/config.ts",
    ),
    [],
  );
  assert.deepEqual(
    offenders(/api\.telnyx\.com|telnyx-signature-ed25519/i, (path) =>
      path.startsWith("lib/comms/providers/telnyx/"),
    ),
    [],
  );
});

test("the domain never reaches the adapters, and never names a vendor's id shape", () => {
  const domain = sources.filter(
    (file) =>
      file.path.startsWith("lib/domain/comms/")
      || file.path === "lib/domain/ports/comms.ts",
  );
  assert.ok(domain.length > 5, "the probe can see lib/domain/comms");
  for (const file of domain) {
    assert.doesNotMatch(
      file.text,
      /from ["']@\/lib\/comms\//,
      `${file.path} imports an adapter`,
    );
    // A Twilio-shaped id check is how a second provider gets silently ignored.
    assert.doesNotMatch(
      file.text,
      /\^CA\[0-9a-f\]|\/\^v3:/,
      `${file.path} validates a provider id's shape`,
    );
  }
});

test("a provider is chosen in one place: the factory's builder table", () => {
  assert.deepEqual(
    offenders(
      /createTwilioAdapter|createTelnyxAdapter/,
      (path) =>
        path === "lib/comms/factory.ts"
        || path.startsWith("lib/comms/providers/"),
    ),
    [],
  );
});

test("the recording workflow's retry literal matches the domain's attempt limit", () => {
  // The workflow sandbox cannot load the domain constant, so the literal is pinned here.
  const workflow = readFileSync(
    join(ROOT, "lib/workflow/call-recording.ts"),
    "utf8",
  );
  assert.equal(
    Number(workflow.match(/storeOne\.maxRetries = (\d+);/)?.[1]),
    MAX_RECORDING_ATTEMPTS - 1,
  );
});
