import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { REPO_ROOT } from "../support/repo-root";
import { NEVER_APPROVE_ON_STAGING } from "@/evals/data/fixtures";
import { ALL_WRITE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "@/evals/data/tools";

/**
 * Structural guards on the eval suite itself.
 *
 * `eve eval` only runs against a deployment, so nothing in `evals/` is
 * exercised by `pnpm test:unit`. These are the properties that can be checked
 * without one, and they are the two that would rot silently: the catalogue in
 * `evals/data/tools.ts` drifting away from the tools that actually exist, and
 * a case that answers `approve` to something that sends a real email.
 */

const SUBAGENTS_DIR = path.join(REPO_ROOT, "agent", "subagents");
const EVALS_DIR = path.join(REPO_ROOT, "evals");

function toolNamesFor(specialist: string): readonly string[] {
  const dir = path.join(SUBAGENTS_DIR, specialist, "tools");
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => entry.replace(/\.ts$/, ""))
    .sort();
}

function declaresApproval(specialist: string, tool: string): boolean {
  const file = path.join(SUBAGENTS_DIR, specialist, "tools", `${tool}.ts`);
  return readFileSync(file, "utf8").includes("ownerOnlyApproval");
}

function evalFiles(dir: string = EVALS_DIR): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return evalFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

describe("evals/data/tools.ts tracks the real capability surface", () => {
  const specialists = readdirSync(SUBAGENTS_DIR, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const specialist of specialists) {
    const tools = toolNamesFor(specialist);
    if (tools.length === 0) continue;

    it(`classifies every ${specialist} tool`, () => {
      const declared = [
        ...((READ_TOOLS as Record<string, readonly string[]>)[specialist]
          ?? []),
        ...((WRITE_TOOLS as Record<string, readonly string[]>)[specialist]
          ?? []),
      ].sort();

      // A new tool that nobody classified would silently shrink what
      // `assertNoMutation` means, so the suite would keep passing while
      // covering less. Adding the name here is the whole fix.
      assert.deepEqual(
        declared,
        [...tools],
        `evals/data/tools.ts is out of step with agent/subagents/${specialist}/tools`,
      );
    });

    it(`puts every owner-approved ${specialist} tool on the write side`, () => {
      const writes = (
        (WRITE_TOOLS as Record<string, readonly string[]>)[specialist] ?? []
      ).slice();
      const approved = tools.filter((tool) =>
        declaresApproval(specialist, tool),
      );
      assert.deepEqual(
        writes.sort(),
        approved.sort(),
        `a tool declaring ownerOnlyApproval() must be listed as a write`,
      );
    });
  }
});

describe("the staging never-approve list", () => {
  it("names only tools that exist and actually gate on approval", () => {
    for (const tool of NEVER_APPROVE_ON_STAGING) {
      assert.ok(
        ALL_WRITE_TOOLS.includes(tool),
        `${tool} is on the never-approve list but is not a known write tool`,
      );
    }
  });

  it("covers every external side effect the issue names", () => {
    // Client email, certifier outreach, DocuSign, invitations, role changes
    // and Xero. If one of these ever drops off the list, a staging run starts
    // reaching a real person.
    for (const tool of [
      "send_compliance_outreach",
      "send_compliance_follow_up",
      "recall_offer_envelope",
      "invite_team_member",
      "revoke_team_invitation",
      "update_team_role",
      "disconnect_xero",
    ]) {
      assert.ok(
        (NEVER_APPROVE_ON_STAGING as readonly string[]).includes(tool),
        `${tool} must stay on the staging never-approve list`,
      );
    }
  });
});

describe("no eval case approves an external side effect", () => {
  const cases = evalFiles().filter((file) => file.endsWith(".eval.ts"));

  it("finds the eval cases", () => {
    assert.ok(cases.length > 0, "no .eval.ts files were discovered");
  });

  for (const file of cases) {
    const relative = path.relative(REPO_ROOT, file).replace(/\\/g, "/");
    it(`${relative} does not pair approve() with a deny-listed tool`, () => {
      const source = readFileSync(file, "utf8");
      if (!/\bapprove\s*\(/.test(source)) return;

      for (const tool of NEVER_APPROVE_ON_STAGING) {
        assert.ok(
          !source.includes(tool),
          // `helpers/approval.ts#approve` also refuses at runtime. This is the
          // earlier, cheaper signal: it fails in CI in a second rather than
          // during a live staging run with a half-sent email behind it.
          `${relative} calls approve() and mentions ${tool}; a deny-listed operation may only be cancelled`,
        );
      }
    });
  }
});
