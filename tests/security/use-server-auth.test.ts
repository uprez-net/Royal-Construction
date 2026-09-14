import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import ts from "typescript";

// Every export of a "use server" module is a Server Action: a POST endpoint
// that runs with whatever arguments the sender chooses, whether or not a screen
// calls it (node_modules/next/dist/docs/01-app/02-guides/data-security.md).
// proxy.ts only proves someone is signed in, and not even that for an action
// posted to a public page such as /book-consultation. So each export has to
// check its caller itself, and createProjectWithLeadAction, the lead and
// project readers and the compliance writers did not.
//
// This scans every such module and fails on an export whose body, or a
// function in the same file that it calls, never reaches one of the checks
// below. It is a tripwire for a missing check, not proof that a check is the
// right one. A module whose exports only server code calls should not be
// "use server" at all: make it `import "server-only"`, as lib/data/leads.ts is.

const ROOT = process.cwd();
const SOURCE_ROOTS = ["app", "components", "constants", "context", "hooks", "lib", "types", "utils"];

// How this codebase checks a caller. Each refuses one it cannot identify.
const CALLER_CHECKS = new Set([
  "auth",
  "authorizeLeadAccess",
  "authorizeOfferAccess",
  "assertCanAccessLead",
  "requireAdminUser",
  "requireInternalUser",
  "requireComplianceAccess",
  "requireComplianceAdmin",
]);

// Exports that still check nobody, each with why it is left for now. None of
// them reads or writes offers, leads, projects, files or envelopes; every entry
// is a follow-up, and the second test fails once one is fixed or removed.
const CUSTOMERS = "customer records; only server code calls it, so it wants server-only (follow-up)";
const SITE_MANAGERS = "site manager lookups; only server code calls it, so it wants server-only (follow-up)";
const TRADIE_APPROVALS = "tradie approvals, called from the browser; tradie domain, outside this pass (follow-up)";
const TRADIES = "tradie records, some called from the browser; tradie domain, outside this pass (follow-up)";
const TRADIE_SCHEDULES = "tradie schedule reads; only server code calls it, so it wants server-only (follow-up)";
const USERS = "user accounts; proxy.ts imports this module, so server-only needs a build check first (follow-up)";

const ALLOWLIST: Record<string, string> = {
  "lib/data/admin-offer-content.ts#getAdminOfferContent":
    "the cached admin boilerplate every offer workspace pre-fills; no customer data, and 'use cache' cannot call auth()",
  "lib/data/customers.ts#createCustomerForProject": CUSTOMERS,
  "lib/data/customers.ts#findCustomerByContact": CUSTOMERS,
  "lib/data/customers.ts#findCustomerById": CUSTOMERS,
  "lib/data/customers.ts#getCachedCustomersForDropdown": CUSTOMERS,
  "lib/data/customers.ts#getCustomersForDropdown": CUSTOMERS,
  "lib/data/siteManagers.ts#getCachedSiteManagersForDropdown": SITE_MANAGERS,
  "lib/data/siteManagers.ts#getSiteManagerById": SITE_MANAGERS,
  "lib/data/siteManagers.ts#getSiteManagersForDropdown": SITE_MANAGERS,
  "lib/data/tradie-approvals.ts#fetchApprovalKPI": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchApprovalKPICached": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchTradieApprovalById": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchTradieApprovals": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchTradieApprovalsCached": TRADIE_APPROVALS,
  "lib/data/tradie-management.ts#createTradie": TRADIES,
  "lib/data/tradie-management.ts#exportTradies": TRADIES,
  "lib/data/tradie-management.ts#fetchFilteredTradies": TRADIES,
  "lib/data/tradie-management.ts#fetchTradieKPIData": TRADIES,
  "lib/data/tradie-management.ts#fetchTradieKPIDataCached": TRADIES,
  "lib/data/tradie-management.ts#getTradieById": TRADIES,
  "lib/data/tradie-management.ts#getTradieByIdCached": TRADIES,
  "lib/data/tradie-management.ts#getTradieGroupedByCategory": TRADIES,
  "lib/data/tradie-management.ts#getTradieGroupedByCategoryCached": TRADIES,
  "lib/data/tradie-management.ts#toggleTradieFavourite": TRADIES,
  "lib/data/tradie-management.ts#updateTradie": TRADIES,
  "lib/data/tradies.ts#getCachedTradieCoordinationDashboard": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getCachedTradieScheduleKPIs": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getCachedTradieSchedules": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getCachedTradies": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradieScheduleKPIs": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradieSchedules": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradies": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradiesForLookup": TRADIE_SCHEDULES,
  "lib/data/user.ts#createUser": USERS,
  "lib/data/user.ts#deleteUser": USERS,
  "lib/data/user.ts#getAllAdminUsersIds": USERS,
  "lib/data/user.ts#getAllUserClerkIds": USERS,
  "lib/data/user.ts#getUserByClerkId": USERS,
  "lib/data/user.ts#getUserByClerkIdCached": USERS,
  "lib/data/user.ts#resolveUserIdsToClerkIds": USERS,
  "lib/data/user.ts#updateUser": USERS,
  "lib/leads/render-email-html.tsx#renderEmailHtml":
    "renders a fixed email template from values the caller already holds; reads no stored data",
  "lib/notification/novu.ts#triggerNotification":
    "sends in-app notifications; only server code calls it, so it wants server-only (follow-up)",
  "utils/generate-email-subject.ts#generateEmailSubject":
    "drafts a subject line from text with the model; reads no data, spends tokens (follow-up)",
};

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(path);
    }
  }
  return found;
}

/** The directive prologue: string-literal statements before any code. */
function isUseServerModule(file: ts.SourceFile): boolean {
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      return false;
    }
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function unwrap(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Every top-level function by name, and every runtime export as
 * [exported name, local function name or null when there is no body to read].
 */
function readModule(file: ts.SourceFile) {
  const functions = new Map<string, ts.Node>();
  const exports: [string, string | null][] = [];

  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      functions.set(name, statement);
      if (isExported(statement)) exports.push([name, name]);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const value = unwrap(declaration.initializer);
        const isFunction =
          value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
        if (isFunction) functions.set(name, value);
        if (isExported(statement)) exports.push([name, isFunction ? name : null]);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const local = statement.moduleSpecifier
          ? null
          : (element.propertyName ?? element.name).text;
        exports.push([element.name.text, local]);
      }
    } else if (ts.isExportAssignment(statement)) {
      exports.push(["default", null]);
    }
  }
  return { functions, exports };
}

function reachesCallerCheck(
  node: ts.Node,
  functions: Map<string, ts.Node>,
  seen: Set<string>,
): boolean {
  let found = false;
  const visit = (current: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const callee = current.expression.text;
      if (CALLER_CHECKS.has(callee)) {
        found = true;
        return;
      }
      const helper = functions.get(callee);
      if (helper && !seen.has(callee)) {
        seen.add(callee);
        if (reachesCallerCheck(helper, functions, seen)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function uncheckedExports(fileName: string, text: string): string[] {
  if (!text.includes("use server")) return [];
  const file = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (!isUseServerModule(file)) return [];
  const { functions, exports } = readModule(file);
  return exports
    .filter(([, local]) => {
      const body = local === null ? undefined : functions.get(local);
      return body === undefined || !reachesCallerCheck(body, functions, new Set([local!]));
    })
    .map(([name]) => name);
}

const unchecked = SOURCE_ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)))
  .flatMap((path) => {
    const file = relative(ROOT, path).split(sep).join("/");
    return uncheckedExports(file, readFileSync(path, "utf8")).map((name) => `${file}#${name}`);
  })
  .sort();

test("the scanner flags exports that check nobody, and only those", () => {
  const flagged = uncheckedExports(
    "sample.ts",
    `"use server";
import { auth } from "@clerk/nextjs/server";
import { authorizeLeadAccess } from "@/lib/data/offer-access";

async function guard() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
}

export async function viaHelper() { await guard(); }
export const direct = async (leadId: number) => authorizeLeadAccess(leadId);
export async function open(id: string) { return id; }
export { open as alsoOpen };
export { elsewhere } from "./elsewhere";
export type Shape = { id: string };
export interface Other { id: string }
`,
  );
  assert.deepEqual(flagged, ["open", "alsoOpen", "elsewhere"]);

  assert.deepEqual(uncheckedExports("after-comment.tsx", `// why\n'use server'\nexport async function open() {}`), ["open"]);
  assert.deepEqual(uncheckedExports("server-only.ts", `import "server-only";\nexport async function open() {}`), []);
  assert.deepEqual(uncheckedExports("late.ts", `import x from "y";\n"use server";\nexport async function open() {}`), []);
});

test("every Server Action checks its caller or is allowlisted with a reason", () => {
  const unexplained = unchecked.filter((key) => !Object.hasOwn(ALLOWLIST, key));
  assert.deepEqual(
    unexplained,
    [],
    `These "use server" exports check nobody. Authorize the caller, move the ` +
      `function to a server-only module, or allowlist it with a reason:\n` +
      unexplained.join("\n"),
  );
});

test("the allowlist names only exports that still check nobody", () => {
  const stale = Object.keys(ALLOWLIST).filter((key) => !unchecked.includes(key));
  assert.deepEqual(stale, [], "these entries are fixed or gone; delete them");
  for (const [key, reason] of Object.entries(ALLOWLIST)) {
    assert.ok(reason.trim() !== "" && !reason.includes("\n"), `${key} needs a one-line reason`);
  }
});
