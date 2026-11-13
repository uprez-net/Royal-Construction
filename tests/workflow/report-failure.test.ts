import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, test, vi } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

const reported = vi.hoisted(() => ({
  errors: [] as Array<{ error: Error; context: Record<string, unknown> }>,
}));
vi.mock("@/lib/observability/report-error", () => ({
  reportError: (error: Error, context: Record<string, unknown>) => {
    reported.errors.push({ error, context });
  },
}));

import {
  describeFailure,
  reportWorkflowError,
  reportWorkflowFailure,
} from "@/lib/workflow/report-failure";

beforeEach(() => {
  reported.errors.length = 0;
});

describe("describeFailure — what is worth an email when a run fails", () => {
  test("an ordinary failure is described with its name, message and stack", () => {
    const error = new Error("Graph 503");
    error.name = "GraphRequestError";
    const failure = describeFailure(error);
    assert.equal(failure?.name, "GraphRequestError");
    assert.equal(failure?.message, "Graph 503");
    assert.ok(failure?.stack);
  });

  test("the HTTP status survives, so a 4xx can still be recognised as a refusal", () => {
    const failure = describeFailure(
      Object.assign(new Error("x"), { status: 503 }),
    );
    assert.equal(failure?.status, 503);
  });

  test("a refusal that crossed the step boundary is recognised by its name", () => {
    // The class is gone after serialisation; the name is what is left.
    for (const name of [
      "DomainValidationError",
      "DomainAuthorizationError",
      "DomainNotFoundError",
      "DomainStaleVersionError",
      "DomainTransitionError",
    ]) {
      const error = new Error("no");
      error.name = name;
      assert.equal(describeFailure(error), null, name);
    }
  });

  test("a side-effect failure is NOT a refusal: the email never went", () => {
    const error = new Error("Email was not sent.");
    error.name = "DomainSideEffectError";
    assert.notEqual(describeFailure(error), null);
  });

  test("a cancelled run is not a failure", () => {
    const error = new Error("run cancelled");
    error.name = "WorkflowRunCancelledError";
    assert.equal(describeFailure(error), null);
  });

  test("a thrown string or nothing at all still produces a report", () => {
    assert.equal(describeFailure("it broke")?.message, "it broke");
    assert.equal(describeFailure(undefined)?.message, "undefined");
  });
});

describe("the reporting step", () => {
  test("rebuilds the error and reports it under the workflow's name", async () => {
    await reportWorkflowFailure("syncSentMail", {
      name: "GraphRequestError",
      message: "Graph 503",
      stack: "at somewhere",
      status: 503,
    });
    assert.equal(reported.errors.length, 1);
    const { error, context } = reported.errors[0];
    assert.equal(error.name, "GraphRequestError");
    assert.equal(error.stack, "at somewhere");
    assert.equal((error as Error & { status: number }).status, 503);
    assert.equal(context.source, "workflow:syncSentMail");
    // One issue per workflow and failure type, not per input message.
    assert.deepEqual(context.fingerprint, [
      "workflow",
      "syncSentMail",
      "GraphRequestError",
    ]);
  });

  test("is never retried: a retry loop around a reporter spends the quota", () => {
    assert.equal(reportWorkflowFailure.maxRetries, 0);
  });

  test("reportWorkflowError reports a fault and stays silent on a refusal", async () => {
    await reportWorkflowError("processInboundLead", new Error("db down"));
    assert.equal(reported.errors.length, 1);

    const refusal = new Error("not found");
    refusal.name = "DomainNotFoundError";
    await reportWorkflowError("processInboundLead", refusal);
    assert.equal(reported.errors.length, 1);
  });
});

describe("every workflow reports a run that fails", () => {
  const dir = join(REPO_ROOT, "lib/workflow");
  const withWorkflow = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) =>
      readFileSync(join(dir, name), "utf8").includes('"use workflow"'),
    );

  test("the survey finds the workflows (guards against the glob rotting)", () => {
    assert.ok(withWorkflow.length >= 9, `found ${withWorkflow.join(", ")}`);
  });

  for (const name of withWorkflow) {
    test(`${name}: the workflow body is wrapped so a failed run is reported`, () => {
      const source = readFileSync(join(dir, name), "utf8");
      // A live call inside a `catch`, followed by the rethrow. Anchored to the
      // start of a line so a commented-out call, or a mention in a comment,
      // does not count: that is exactly how this protection gets lost.
      assert.match(
        source,
        /catch \(error\) \{\r?\n\s*await reportWorkflowError\("\w+", error\);\r?\n\s*throw error;/,
        `${name} has a "use workflow" function that does not report a failed run and rethrow it in a catch. Wrap its body: see lib/workflow/report-failure.ts`,
      );
      assert.match(source, /from "@\/lib\/workflow\/report-failure"/);
    });
  }
});
