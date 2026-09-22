import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The create-project wizard called createProjectWithLeadAction, a Server Action
// in lib/data/projectsWrite.ts that converted whatever leadId it was handed:
// customer, project, milestones and an inference, for a lead the caller might
// not be able to open. The action now lives in lib/actions/projects.ts and
// checks the lead first. Both files load Prisma or Clerk, so no test can import
// them; this reads the source instead.

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const actions = read("lib/actions/projects.ts");
const writes = read("lib/data/projectsWrite.ts");
// The conversion itself moved to lib/domain in phase 4 of issue #301. The
// domain module is Node-safe, so the re-parenting rule below could now be
// exercised through `recordingDb` instead of read out of the source — but the
// point of this test is that the WHERE clause never grows a url match again,
// and a source assertion says that in one line.
const creation = read("lib/domain/projects/creation.ts");

function functionBody(text: string, name: string): string {
  const start = text.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = text.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} has no end`);
  return text.slice(start, end);
}

test("the wizard's action authorizes the lead before converting it", () => {
  assert.match(actions, /^"use server";/);
  const body = functionBody(actions, "createProjectWithLeadAction");
  const check = body.indexOf("authorizeLeadAccess(input.leadId)");
  assert.ok(
    check >= 0,
    "createProjectWithLeadAction never authorizes the lead",
  );
  assert.ok(
    check < body.indexOf("createProjectWithLead(parsed.data)"),
    "the lead is converted before the caller is checked",
  );
});

test("the whole payload is parsed before the lead is converted", () => {
  // Only leadId was checked here; the rest went to createProjectWithLead, which
  // writes `parties` onto Project.parties, trusts siteManagerId and runs
  // new Date() over both date strings. The schema's own shape is pinned in
  // create-project-payload.test.ts; this pins that the action still uses it.
  const body = functionBody(actions, "createProjectWithLeadAction");
  const parse = body.indexOf("createProjectWithLeadSchema.safeParse(input)");
  assert.ok(
    parse >= 0,
    "createProjectWithLeadAction no longer parses its input",
  );
  assert.ok(
    parse < body.indexOf("createProjectWithLead(parsed.data)"),
    "the lead is converted before the payload is validated",
  );
  assert.match(body, /failure: failureFromThrownError\(parsed\.error\)/);
});

test("a refusal is returned as a failure, not thrown", () => {
  // Next replaces a thrown Server Action message with a digest in production,
  // so a thrown refusal would reach the wizard as "something went wrong".
  const body = functionBody(actions, "createProjectWithLeadAction");
  assert.match(
    body,
    /if \(!access\.ok\) \{\s*return \{\s*ok: false,\s*failure: createProjectFailure\(\s*"FORBIDDEN"/,
  );
});

test("conversion re-parents only the lead's own files, never a File matched by a browser URL", () => {
  // sourceDocuments comes from the browser with the lead id, and the lead check
  // says nothing about which files those URLs belong to. Matching by URL moved
  // any File row with that URL, such as another project's signed contract,
  // onto the new project.
  const body = functionBody(creation, "createProjectFromLead");
  const start = body.indexOf("db.file.updateMany(");
  assert.ok(
    start >= 0,
    "createProjectFromLead no longer re-parents the lead's files",
  );
  const where = body.slice(start, body.indexOf("data:", start));
  assert.match(where, /where: \{\s*leadId: lead\.id\s*,?\s*\}/);
  assert.doesNotMatch(where, /\burl\b|sourceDocuments/);
});

test("the conversion is one transaction, opened by the adapter", () => {
  // The customer, the project, its whole milestone template, the activity
  // entry and the file re-parenting are one fact. They used to be a customer
  // write and an inference outside the transaction and the rest inside, so a
  // failure in between left a customer record for a project that never
  // existed. The command composes into the caller's transaction rather than
  // opening its own, which is what lets an Eve tool audit it in one.
  assert.match(writes, /prisma\.\$transaction\(/);
  assert.match(writes, /createProjectFromLead\(principal, input, tx/);
  assert.doesNotMatch(creation, /\$transaction/);
});

test("the unauthorized conversion is no longer a Server Action", () => {
  assert.doesNotMatch(writes, /^["']use server["']/m);
  assert.doesNotMatch(
    writes,
    /export async function createProjectWithLeadAction/,
  );
  assert.match(
    read("lib/store/slices/projectsSlice.ts"),
    /import \{ createProjectWithLeadAction \} from "@\/lib\/actions\/projects";/,
  );
});
