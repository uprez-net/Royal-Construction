import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test } from "vitest";

import { authorizeLead } from "@/lib/domain/access/leads";
import { canWorkComplianceFile } from "@/lib/domain/access/compliance";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
} from "@/lib/domain/errors";
import {
  assertCanBrowseCustomers,
  listCustomersForDropdown,
} from "@/lib/domain/identity/customers";
import { anonymousPrincipal } from "@/lib/domain/principal";
import { hideListProjectFinancials } from "@/lib/domain/projects/financial-redaction";
import type { ProjectWithStats } from "@/types/project";

import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";
import { REPO_ROOT } from "../support/repo-root";

// Follow-ups from the staging QA of #559, as a site manager (#568–#572).

const SM = "user_sm";

/* --------------------------------------------- #569: refusals, not 500s -- */

test("a site manager is refused a lead before it is looked up, whether or not it exists", async () => {
  // A 404 for a missing id and a 403 for a real one told a site manager which
  // leads exist. Refused before the read, both answer alike.
  for (const leadId of [106, 999_999]) {
    const recorder = recordingDb();
    await assert.rejects(
      authorizeLead(siteManagerPrincipal(SM), leadId, recorder.db),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.operations(), []);
  }
  const recorder = recordingDb();
  await assert.rejects(
    authorizeLead(anonymousPrincipal("test"), 1, recorder.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.operations(), []);
});

test("the office still hears that a lead is missing", async () => {
  const recorder = recordingDb({ "lead.findUnique": null });
  await assert.rejects(
    authorizeLead(adminPrincipal(), 999_999, recorder.db),
    DomainNotFoundError,
  );
});

test("the customer list refuses a site manager before reading it", async () => {
  assert.throws(
    () => assertCanBrowseCustomers(siteManagerPrincipal(SM)),
    DomainAuthorizationError,
  );
  assert.doesNotThrow(() => assertCanBrowseCustomers(adminPrincipal()));
  const recorder = recordingDb();
  await assert.rejects(
    listCustomersForDropdown(siteManagerPrincipal(SM), {}, recorder.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.operations(), []);
});

test("the routes QA saw answer a bare 500 now surface the domain's refusal", () => {
  // tests/architecture/domain-error-surfacing.test.ts only sees routes that
  // catch; these did not catch at all.
  for (const route of [
    "app/api/(data)/customers/route.ts",
    "app/api/(data)/projects/[projectId]/milestones/route.ts",
    "app/api/(data)/leads/[leadId]/route.ts",
  ]) {
    const source = readFileSync(join(REPO_ROOT, route), "utf8");
    assert.match(source, /domainErrorResponse\(error\)/, route);
  }
  // Access before the existence check, so a refusal does not depend on the id.
  const leadRoute = readFileSync(
    join(REPO_ROOT, "app/api/(data)/leads/[leadId]/route.ts"),
    "utf8",
  );
  assert.doesNotMatch(leadRoute, /findLeadById/);
  assert.match(leadRoute, /authorizeLead\(/);
});

test("the public booking route answers a body that is not a JSON object with 400", () => {
  // The route reaches `server-only` and cannot be loaded here, so this reads
  // its source: the body is parsed without throwing and checked to be an
  // object before anything reads a field off it.
  const source = readFileSync(
    join(REPO_ROOT, "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  const parse = source.indexOf("await req.json().catch(() => undefined)");
  const guard = source.indexOf(
    'typeof parsed !== "object" || Array.isArray(parsed)',
  );
  const firstRead = source.indexOf("startDateTime, notes } = body");
  assert.ok(parse > 0, "the body is parsed without throwing");
  assert.ok(guard > parse && firstRead > guard, "and checked before use");
  assert.match(
    source.slice(guard, firstRead),
    /status: 400/,
    "a body that is not an object answers 400",
  );
});

/* ------------------------------- #568: draw only what will be accepted -- */

test("the compliance file is worked by the office and the owning customer, never a site manager or a guest", () => {
  const project = {
    customerId: "c_1",
    leadAssignedId: "user_sales",
    siteManagerId: SM,
  };
  assert.equal(canWorkComplianceFile(adminPrincipal(), project), true);
  // Owner, 2026-11-20: the compliance file is the office's paperwork, so not
  // even the assigned site manager works it.
  assert.equal(canWorkComplianceFile(siteManagerPrincipal(SM), project), false);
  assert.equal(
    canWorkComplianceFile(siteManagerPrincipal("user_other_sm"), project),
    false,
  );
  assert.equal(
    canWorkComplianceFile(
      { kind: "user", role: "GUEST", userId: "user_sales" } as never,
      project,
    ),
    false,
  );
  assert.equal(
    canWorkComplianceFile(
      { ...customerPrincipal(), customerId: "c_1" } as never,
      project,
    ),
    true,
  );
  assert.equal(canWorkComplianceFile(anonymousPrincipal("x"), project), false);
});

test("the project page is told what the caller may record, from the commands' own rules", () => {
  const source = readFileSync(
    join(REPO_ROOT, "lib/domain/projects/queries.ts"),
    "utf8",
  );
  assert.match(source, /compliance: canWorkComplianceFile\(principal/);
  assert.match(source, /manage: canManageProject\(principal/);
  assert.match(source, /record: canRecordOnProject\(principal/);
  assert.match(source, /book: canBookTradies\(principal\)/);
  assert.match(source, /history: canSeeProjectHistory\(principal\)/);
  // The Overview tab's save is `authorizeProjectEdit`, which also admits the
  // lead's assignee: its own flag, not `manage`.
  assert.match(source, /edit: canEditProject\(principal/);
});

/* --------------------------------------- #570: no sales record on site -- */

test("a hidden list row drops the lead it came from", () => {
  const row = {
    approvedVariationSpend: "1",
    invoiceTotals: {},
    invoices: [],
    leadId: 42,
    spent: "1",
    totalBudget: "1",
  } as unknown as ProjectWithStats;
  assert.equal(hideListProjectFinancials(row).leadId, null);
});
