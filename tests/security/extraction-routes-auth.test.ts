import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { isBlobStorageUrl } from "../../lib/blob-url";

// Both extraction routes start a durable run from ids and URLs in the request
// body. extract-project-data checked only that someone was signed in, so any
// user could read any lead into a tender extraction and have the OCR step fetch
// any URL; extract-checklist checked that its three ids matched each other,
// which anyone who has seen the project can satisfy. The routes load Clerk and
// the workflow runtime, so no test can import them; this reads the source.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const projectRoute = read("app/api/(workflow)/extract-project-data/route.ts");
const checklistRoute = read("app/api/(workflow)/extract-checklist/route.ts");

function before(text: string, first: string, second: string) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  assert.ok(a >= 0, `expected ${first}`);
  assert.ok(b >= 0, `expected ${second}`);
  assert.ok(a < b, `${first} must come before ${second}`);
}

test("the tender extraction authorizes the lead before starting the run", () => {
  before(projectRoute, "authorizeLeadAccess(input.leadId)", "start(");
  assert.match(projectRoute, /if \(!access\.ok\) \{\s*return forbiddenResponse\(access\.error\);/);
});

test("the tender extraction only OCRs files in Blob storage", () => {
  before(projectRoute, "isBlobStorageUrl(input.tenderUrl)", "start(");
  before(projectRoute, "isBlobStorageUrl(input.contractUrl)", "start(");
});

test("the run capability is issued to the user the lead check resolved", () => {
  // #249's capability binds the run to a user; it must be the one that passed
  // the check, not a second lookup that could disagree with it.
  assert.match(projectRoute, /signRunCapability\(\{ runId: run\.runId, userId: access\.user\.id \}\)/);
});

test("the checklist extraction applies the compliance project gate before starting", () => {
  before(checklistRoute, "requireComplianceAccess(input.projectId)", "start(");
  before(checklistRoute, "requireComplianceAccess(input.projectId)", "prisma.complianceDocument.findFirst(");
  assert.match(checklistRoute, /const refusal = complianceAccessResponse\(error\);\s*if \(refusal\) return refusal;/);
  assert.match(checklistRoute, /signRunCapability\(\{ runId: run\.runId, userId: user\.id \}\)/);
});

test("a Blob upload passes and anything else does not", () => {
  assert.equal(
    isBlobStorageUrl(
      "https://udafiztdzg1cn8u2.public.blob.vercel-storage.com/leads/12/abc-tender.pdf",
    ),
    true,
  );
  for (const url of [
    "http://udafiztdzg1cn8u2.public.blob.vercel-storage.com/leads/12/abc-tender.pdf",
    "https://example.com/tender.pdf",
    "https://public.blob.vercel-storage.com.evil.example/tender.pdf",
    "https://evil.example/x.public.blob.vercel-storage.com/tender.pdf",
    "https://user:pass@udafiztdzg1cn8u2.public.blob.vercel-storage.com/a.pdf",
    "file:///etc/passwd",
    "",
  ]) {
    assert.equal(isBlobStorageUrl(url), false, url);
  }
  assert.equal(isBlobStorageUrl(null), false);
});
