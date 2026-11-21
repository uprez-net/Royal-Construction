import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import { hideRequirementsFinancials } from "@/lib/domain/projects/financial-redaction";
import type { ProjectRequirementsPayload } from "@/types/project-flow";

import { REPO_ROOT } from "../support/repo-root";

// Found on staging 2026-11-21: a site manager's Overview save, and the
// Slab-start insurance dates dialog, both send the requirements they were
// shown straight back. The redacted copy carried blank tender and contract
// links, which the PATCH refuses (a link needs a file id, name and URL), so
// every site manager save answered 400.

const STORED = {
  legalAdministration: { pcaInspector: "Jo", siteAddress: "12 Rose St" },
  sourceDocuments: {
    contract: {
      fileId: "f_c",
      fileName: "contract.pdf",
      kind: "contract",
      url: "https://blob.example/contract.pdf",
    },
    tender: {
      fileId: "f_t",
      fileName: "tender.pdf",
      kind: "tender",
      url: "https://blob.example/tender.pdf",
    },
  },
  summary: "Brick veneer",
} as unknown as ProjectRequirementsPayload;

test("the copy a site manager is shown has no tender or contract links, not blank ones", () => {
  const shown = hideRequirementsFinancials(STORED) as unknown as Record<
    string,
    unknown
  >;
  assert.equal("sourceDocuments" in shown, false);
  // Everything else they build from is still there.
  assert.equal(shown.summary, "Brick veneer");
  assert.deepEqual(shown.legalAdministration, {
    pcaInspector: "Jo",
    siteAddress: "12 Rose St",
  });
  // The stored copy is untouched.
  assert.ok(STORED.sourceDocuments.tender.url);
});

test("a copy with no links needs nothing the PATCH would refuse", () => {
  // The route's schema makes `sourceDocuments` optional but each link strict
  // (fileId, fileName, url all non-empty), so absence is the only shape a
  // caller who may not see the links can send.
  const shown = hideRequirementsFinancials(STORED) as unknown as {
    sourceDocuments?: Record<string, { fileId: string; url: string }>;
  };
  const links = Object.values(shown.sourceDocuments ?? {});
  assert.ok(links.every((link) => link.fileId !== "" && link.url !== ""));
});

test("an unsigned Clerk webhook call is a 401, not a 500", () => {
  // `verifyWebhook` throws for a missing or wrong signature; uncaught, that
  // reached the outer catch (500) and reported an incident per probe. The
  // route has no seam for a Clerk client, so this pins the wiring, as the
  // other webhook tests do.
  const route = readFileSync(
    join(REPO_ROOT, "app/api/webhook/clerk/route.ts"),
    "utf8",
  );
  // ... but a missing signing secret is our fault and must stay a 500 (and
  // reported), checked before the verify step so the 401 cannot hide it.
  assert.match(
    route,
    /if \(!process\.env\.CLERK_WEBHOOK_SIGNING_SECRET\) \{\s*throw new Error[\s\S]*?const evt = await verifyWebhook/,
  );
  assert.match(
    route,
    /const evt = await verifyWebhook\(request\)\.catch\(\(\) => null\);\s*if \(!evt\) \{[\s\S]*?status: 401/,
  );
});

test("the project detail route answers a refusal, not a 500", () => {
  // Found on staging with a GUEST past the proxy: the handler had no error
  // handling, so the domain's refusal escaped as a 500 (an incident in
  // production). Same family as #569.
  const route = readFileSync(
    join(REPO_ROOT, "app/api/(data)/projects/[projectId]/route.ts"),
    "utf8",
  );
  const get = route.slice(route.indexOf("export async function GET"));
  const handler = get.slice(0, get.indexOf("export async function", 10));
  assert.match(
    handler,
    /try \{[\s\S]*getCachedProjectById[\s\S]*domainErrorResponse\(error\)/,
  );
});

test("the cached project read asks the read rule before the cache, so a refusal is a real DomainError", () => {
  // CodeRabbit (#582): an error thrown inside a "use cache" body may reach the
  // route as something other than the DomainError it was. The read rule is
  // asked first, outside the cache, for the caller's principal.
  const data = readFileSync(join(REPO_ROOT, "lib/data/projects.ts"), "utf8");
  const wrapper = data.slice(
    data.indexOf("export async function getCachedProjectById"),
  );
  assert.match(
    wrapper.slice(0, wrapper.indexOf("}\n")),
    /projectReadScope\(principal\);[\s\S]*cachedProjectById\(principal, id\)/,
  );
});
