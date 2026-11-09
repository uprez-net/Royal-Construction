import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { test } from "vitest";

// Every export of a "use server" module is a Server Action: a POST endpoint
// that runs with whatever arguments the sender chooses, whether or not a screen
// calls it (node_modules/next/dist/docs/01-app/02-guides/data-security.md).
// proxy.ts only proves someone is signed in, and not even that for an action
// posted to a public page such as /book-consultation. So each export has to
// check its caller itself, and createProjectWithLeadAction, the lead and
// project readers and the compliance writers did not.
//
// This scans every such module in the repo and sorts each export by the
// strongest check its body, or a function in the same file that it calls,
// reaches: a caller check below, only auth(), or nothing. It is a tripwire for
// a missing check, not proof that a check is the right one. A module whose
// exports only server code calls should not be "use server" at all: make it
// `import "server-only"`, as lib/data/leads.ts is.

const ROOT = process.cwd();

// How this codebase checks a caller. Each does more than prove sign-in: it
// refuses a caller without the role or the record, or (leadListScope) narrows
// a listing to the leads the caller may open.
const CALLER_CHECKS = new Set([
  "authorizeLeadAccess",
  "authorizeOfferAccess",
  "assertCanAccessLead",
  "leadListScope",
  "requireAdminUser",
  "requireInternalUser",
  "requireComplianceAccess",
  "requireComplianceAdmin",
  // lib/domain commands that refuse the caller themselves (issue #301). Each
  // one calls requireAdminPrincipal or assertCanReadTradieDirectory before it
  // touches anything, so an export that reaches one has checked a role — the
  // auth() above it only resolves who is asking.
  "createTradieDomain",
  "updateTradieDomain",
  "toggleTradieFavouriteDomain",
  "requestTradiePriceChange",
  "requestTradieRemoval",
  "rateTradieDomain",
  "reportTradieIncidentDomain",
  // Both call authorizeLead before anything reaches blob storage, so the
  // caller has been checked against the record — the lead — and not merely
  // proved to be signed in. They also refuse a Blob path outside that lead's
  // namespace. deleteLeadFile additionally owns the delete itself, so the
  // refusal and the absence of the effect are the same thing.
  "authorizeLeadFileDeletion",
  "deleteLeadFile",
  // These offer commands authorize the lead/offer or require an internal
  // principal before reading or mutating anything. The Server Actions resolve
  // that principal; the shared command owns the record/role decision.
  "checkOfferListsDomain",
  "draftOfferHighlights",
  "generateOfferPrefill",
  "prepareProjectHandoff",
  "commitOfferStatusTransition",
  // Removal impact is admin-only in the shared domain query.
  "getTradieRemovalImpact",
  // The tradie activity log: assertCanReadTradieDirectory before the read,
  // and project names only for projects the caller may manage.
  "listTradieActivity",
  // The Tradies tab's request, quote and selection commands. Each calls
  // authorizeProject (ADMIN, or the project's site manager) before it reads
  // or writes anything; deliverTradieRequest does so for the "manual" trigger,
  // the only one an adapter passes it.
  "sendTradieRequests",
  "deliverTradieRequest",
  "recordManualQuote",
  "selectTradeQuote",
  "requestTradeCancellation",
  "draftTradieRequestWorkDetails",
  // The Financials tab (issue #405). Each calls requireAdminPrincipal and
  // authorizeProject before it reads a figure or writes an invoice.
  "getProjectFinancials",
  "recordTradieInvoice",
  "allocateTradieInvoice",
  "voidTradieInvoice",
  "setMilestonePrice",
  // Request recheck: both call requireAdminPrincipal and authorizeProject
  // before they read the booking or send anything.
  "prepareTradieInvoiceRecheck",
  "requestTradieInvoiceRecheck",
  "readTradieInvoiceDocument",
  "dismissEmailedTradieInvoice",
  "getVariationOptions",
  "draftVariation",
  "raiseVariation",
  "issueVariation",
  "getProjectVariations",
]);

// auth() alone passes every signed-in user, customers included. An export
// whose only check is this has to be listed in SIGNED_IN_ONLY with what else
// limits it, so `await auth()` followed by a write to someone else's record
// does not pass as checked.
const SIGN_IN_CHECK = "auth";

// Helpers private to one module that check a role or record after auth().
// Keyed by file so a same-named function elsewhere earns nothing.
const LOCAL_CHECKS: Record<string, string> = {
  "lib/data/tradie-approvals.ts#authorisedForApproval":
    "refuses anyone but an ADMIN",
  "lib/data/tradieSchedules.ts#userHasAccessToSchedule":
    "refuses anyone but the project's site manager or an ADMIN",
};

// Exports whose only check is sign-in, each with why that is enough for now.
const SIGNED_IN_ONLY: Record<string, string> = {};

// Exports that check nobody, each with why it is left for now. None reads or
// writes offers, leads, files or envelopes, but some return project data: the
// tradie schedule reads include each schedule's whole project row. Every entry
// is a follow-up, and the last test fails once one is fixed or removed.
const TRADIE_APPROVALS =
  "tradie approvals, called from the browser; tradie domain, outside this pass (follow-up)";
const TRADIES =
  "tradie records, some called from the browser; tradie domain, outside this pass (follow-up)";
const TRADIE_SCHEDULES =
  "tradie schedule reads, some returning whole project rows; only server code calls it, so it wants server-only (follow-up)";
// lib/data/user.ts is no longer a "use server" module (issue #301). Every one
// of its exports used to be a POST endpoint, updateUser included — so
// `updateUser(clerkId, { role: "ADMIN" })` was reachable by any signed-in
// caller. Nothing ever called it from a client component, so dropping the
// directive closed the surface outright. `import "server-only"` is still not
// there, and that part of the follow-up stands: proxy.ts imports
// getUserByClerkId and the middleware runtime cannot load it.

const ALLOWLIST: Record<string, string> = {
  "lib/data/admin-offer-content.ts#getAdminOfferContent":
    "the cached admin boilerplate every offer workspace pre-fills; no customer data, and 'use cache' cannot call auth()",
  // lib/data/customers.ts and lib/data/siteManagers.ts were listed here as
  // known follow-ups: every export was a POST endpoint, and both
  // `findCustomerById` and `getSiteManagerById` answered a whole record to any
  // signed-in caller who posted an id at them. Phase 4 of issue #301 dropped
  // the `"use server"` directive from both, so the surface is gone rather than
  // guarded — the same fix phase 7 applied to lib/data/user.ts.
  "lib/data/tradie-approvals.ts#fetchApprovalKPI": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchApprovalKPICached": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchTradieApprovalById": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchTradieApprovals": TRADIE_APPROVALS,
  "lib/data/tradie-approvals.ts#fetchTradieApprovalsCached": TRADIE_APPROVALS,
  "lib/data/tradie-management.ts#exportTradies": TRADIES,
  "lib/data/tradie-management.ts#fetchFilteredTradies": TRADIES,
  "lib/data/tradie-management.ts#fetchTradieKPIData": TRADIES,
  "lib/data/tradie-management.ts#fetchTradieKPIDataCached": TRADIES,
  "lib/data/tradie-management.ts#getTradieById": TRADIES,
  "lib/data/tradie-management.ts#getTradieByIdCached": TRADIES,
  "lib/data/tradie-management.ts#getTradieGroupedByCategory": TRADIES,
  "lib/data/tradie-management.ts#getTradieGroupedByCategoryCached": TRADIES,
  "lib/data/tradies.ts#getCachedTradieCoordinationDashboard": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getCachedTradieScheduleKPIs": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getCachedTradieSchedules": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getCachedTradies": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradieScheduleKPIs": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradieSchedules": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradies": TRADIE_SCHEDULES,
  "lib/data/tradies.ts#getTradiesForLookup": TRADIE_SCHEDULES,
};

type Check = "caller" | "signed-in" | "none";

// The whole repo, not a list of source folders: a "use server" file anywhere
// the app imports it from is an endpoint.
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

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The directive prologue: string-literal statements before any code. */
function isUseServerModule(file: ts.SourceFile): boolean {
  for (const statement of file.statements) {
    if (
      !ts.isExpressionStatement(statement)
      || !ts.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function unwrap(
  expression: ts.Expression | undefined,
): ts.Expression | undefined {
  let current = expression;
  while (
    current
    && (ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isSatisfiesExpression(current))
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
          value !== undefined
          && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
        if (isFunction) functions.set(name, value);
        if (isExported(statement))
          exports.push([name, isFunction ? name : null]);
      }
    } else if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
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

function stronger(a: Check, b: Check): Check {
  if (a === "caller" || b === "caller") return "caller";
  if (a === "signed-in" || b === "signed-in") return "signed-in";
  return "none";
}

function checkReached(
  fileName: string,
  node: ts.Node,
  functions: Map<string, ts.Node>,
  seen: Set<string>,
): Check {
  let reached: Check = "none";
  const visit = (current: ts.Node) => {
    if (reached === "caller") return;
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const callee = current.expression.text;
      const helper = functions.get(callee);
      if (
        CALLER_CHECKS.has(callee)
        || (helper !== undefined
          && Object.hasOwn(LOCAL_CHECKS, `${fileName}#${callee}`))
      ) {
        reached = "caller";
        return;
      }
      if (callee === SIGN_IN_CHECK) {
        reached = stronger(reached, "signed-in");
      }
      if (helper && !seen.has(callee)) {
        seen.add(callee);
        reached = stronger(
          reached,
          checkReached(fileName, helper, functions, seen),
        );
        if (reached === "caller") return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return reached;
}

/** Each runtime export of a "use server" module, with the strongest check it reaches. */
function classifyExports(fileName: string, text: string): [string, Check][] {
  if (!text.includes("use server")) return [];
  const file = parse(fileName, text);
  if (!isUseServerModule(file)) return [];
  const { functions, exports } = readModule(file);
  return exports.map(([name, local]) => {
    const body = local === null ? undefined : functions.get(local);
    const check =
      body === undefined
        ? "none"
        : checkReached(fileName, body, functions, new Set([local!]));
    return [name, check];
  });
}

const classified: [string, Check][] = sourceFiles(ROOT)
  .flatMap((path) => {
    const file = relative(ROOT, path).split(sep).join("/");
    return classifyExports(file, readFileSync(path, "utf8")).map(
      ([name, check]): [string, Check] => [`${file}#${name}`, check],
    );
  })
  .sort(([a], [b]) => a.localeCompare(b));

const withCheck = (check: Check) =>
  classified.filter(([, c]) => c === check).map(([key]) => key);
const unchecked = withCheck("none");
const signedInOnly = withCheck("signed-in");

test("the scanner tells a caller check from sign-in alone and from nothing", () => {
  const sample = classifyExports(
    "sample.ts",
    `"use server";
import { auth } from "@clerk/nextjs/server";
import { authorizeLeadAccess } from "@/lib/data/offer-access";

async function signedIn() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
}

export async function viaHelper() { await signedIn(); }
export async function signInThenLead(leadId: number) { await signedIn(); return authorizeLeadAccess(leadId); }
export const direct = async (leadId: number) => authorizeLeadAccess(leadId);
export async function open(id: string) { return id; }
export { open as alsoOpen };
export { elsewhere } from "./elsewhere";
export type Shape = { id: string };
export interface Other { id: string }
`,
  );
  assert.deepEqual(sample, [
    ["viaHelper", "signed-in"],
    ["signInThenLead", "caller"],
    ["direct", "caller"],
    ["open", "none"],
    ["alsoOpen", "none"],
    ["elsewhere", "none"],
  ]);

  // A listed local helper counts only in its own file.
  const approvals = `"use server";
import { auth } from "@clerk/nextjs/server";
const authorisedForApproval = async () => { await auth(); };
export async function approve() { await authorisedForApproval(); }
`;
  assert.deepEqual(classifyExports("lib/data/tradie-approvals.ts", approvals), [
    ["approve", "caller"],
  ]);
  assert.deepEqual(classifyExports("lib/data/other.ts", approvals), [
    ["approve", "signed-in"],
  ]);

  assert.deepEqual(
    classifyExports(
      "after-comment.tsx",
      `// why\n'use server'\nexport async function open() {}`,
    ),
    [["open", "none"]],
  );
  assert.deepEqual(
    classifyExports(
      "server-only.ts",
      `import "server-only";\nexport async function open() {}`,
    ),
    [],
  );
  assert.deepEqual(
    classifyExports(
      "late.ts",
      `import x from "y";\n"use server";\nexport async function open() {}`,
    ),
    [],
  );
});

test("every Server Action checks its caller or is allowlisted with a reason", () => {
  const unexplained = unchecked.filter((key) => !Object.hasOwn(ALLOWLIST, key));
  assert.deepEqual(
    unexplained,
    [],
    `These "use server" exports check nobody. Authorize the caller, move the `
      + `function to a server-only module, or allowlist it with a reason:\n`
      + unexplained.join("\n"),
  );
});

test("a Server Action that only proves sign-in is listed with what else limits it", () => {
  const unexplained = signedInOnly.filter(
    (key) => !Object.hasOwn(SIGNED_IN_ONLY, key),
  );
  assert.deepEqual(
    unexplained,
    [],
    `These "use server" exports only call auth(), which every signed-in user `
      + `passes, customers included. Check the role or the record, or list the `
      + `export in SIGNED_IN_ONLY with why sign-in is enough:\n`
      + unexplained.join("\n"),
  );
});

test("the lists name only exports that still need them, each with a one-line reason", () => {
  assert.deepEqual(
    Object.keys(ALLOWLIST).filter((key) => !unchecked.includes(key)),
    [],
    "these ALLOWLIST entries now check their caller or are gone; delete them",
  );
  assert.deepEqual(
    Object.keys(SIGNED_IN_ONLY).filter((key) => !signedInOnly.includes(key)),
    [],
    "these SIGNED_IN_ONLY entries now check more, or nothing, or are gone; move or delete them",
  );
  for (const key of Object.keys(LOCAL_CHECKS)) {
    const [file, name] = key.split("#");
    const { functions } = readModule(
      parse(file, readFileSync(join(ROOT, file), "utf8")),
    );
    assert.ok(
      functions.has(name),
      `${key} no longer exists; delete it from LOCAL_CHECKS`,
    );
  }
  for (const [key, reason] of Object.entries({
    ...ALLOWLIST,
    ...SIGNED_IN_ONLY,
    ...LOCAL_CHECKS,
  })) {
    assert.ok(
      reason.trim() !== "" && !reason.includes("\n"),
      `${key} needs a one-line reason`,
    );
  }
});
