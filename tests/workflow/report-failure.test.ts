import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, test, vi } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

const reported = vi.hoisted(() => ({
  errors: [] as Array<{ error: Error; context: Record<string, unknown> }>,
}));
vi.mock("@/lib/observability/report-error", async (importOriginal) => ({
  // Everything the real module does except the final send, so a vendor report
  // still goes through the real capture path (and tags the stack inside a step).
  ...(await importOriginal<
    typeof import("@/lib/observability/report-error")
  >()),
  reportError: (error: Error, context: Record<string, unknown>) => {
    reported.errors.push({ error, context });
  },
}));
vi.mock("@sentry/core", () => ({
  captureException: () => {},
  withScope: (callback: (scope: unknown) => void) =>
    callback({
      setTag() {},
      setContext() {},
      setUser() {},
      setLevel() {},
      setFingerprint() {},
    }),
  flush: async () => true,
}));

import { reportExternalError } from "@/lib/observability/external";
import {
  carryReportAcrossSteps,
  inWorkflowStep,
  REPORTED_STACK_MARKER,
} from "@/lib/observability/workflow-context";
import {
  describeFailure,
  failureSignature,
  reportWorkflowError,
  reportWorkflowFailure,
} from "@/lib/workflow/report-failure";

beforeEach(() => {
  reported.errors.length = 0;
});

// How the Workflow runtime hands a failed step to the workflow body
// (`@workflow/core`, `step.js`): `new FatalError(message)` with the stored stack
// copied back on. Nothing else about the original error survives.
function rebuiltByTheRuntime(original: Error): Error {
  const rebuilt = new Error(original.message);
  rebuilt.name = "FatalError";
  rebuilt.stack = original.stack;
  return rebuilt;
}

// Runs `work` as the runtime runs a step: with the process-wide step context
// set. It is a `globalThis` singleton precisely so any code can read it.
const STEP_CONTEXT = Symbol.for("WORKFLOW_STEP_CONTEXT_STORAGE");
async function insideAStep<T>(work: () => Promise<T> | T): Promise<T> {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[STEP_CONTEXT];
  const storage = new AsyncLocalStorage<unknown>();
  globals[STEP_CONTEXT] = storage;
  try {
    return await storage.run({ stepMetadata: { attempt: 1 } }, work);
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globals, STEP_CONTEXT);
    else globals[STEP_CONTEXT] = previous;
  }
}

describe("describeFailure — what reaches the workflow's catch", () => {
  test("a failed run is described by its message and stack", () => {
    const error = new Error("Graph error 503: {}");
    error.name = "FatalError";
    const failure = describeFailure(error);
    assert.equal(failure?.name, "FatalError");
    assert.equal(failure?.message, "Graph error 503: {}");
    assert.ok(failure?.stack);
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

  test("a failure whose stack says a layer already reported it is left to that layer", () => {
    const error = new Error("Graph error 503");
    error.stack = `${error.stack}\n${REPORTED_STACK_MARKER}`;
    assert.equal(describeFailure(error), null);
  });
});

describe("one failed run is one report, even though the error is rebuilt", () => {
  test("the runtime rebuild loses the class, the status and any object mark", () => {
    // The premise. If a Workflow upgrade starts carrying these across, this
    // describes a world the marker no longer needs to handle.
    const original = Object.assign(new Error("Graph error 503"), {
      name: "GraphRequestError",
      status: 503,
    });
    const rebuilt = rebuiltByTheRuntime(original) as Error & {
      status?: number;
    };
    assert.equal(rebuilt.name, "FatalError");
    assert.equal(rebuilt.status, undefined);
  });

  test("a vendor layer's report inside a step is not repeated by the workflow", async () => {
    const original = Object.assign(new Error("Graph error 503: {}"), {
      status: 503,
    });

    // The vendor layer reports from inside the step ...
    await insideAStep(() => {
      assert.equal(inWorkflowStep(), true);
      assert.equal(
        reportExternalError("graph", "list mailbox", original),
        true,
      );
    });
    // ... the step fails terminally, and the workflow gets a rebuilt error ...
    const rebuilt = rebuiltByTheRuntime(original);
    // ... which the workflow layer leaves alone.
    assert.equal(describeFailure(rebuilt), null);
    await reportWorkflowError("syncSentMail", rebuilt);
    assert.equal(
      reported.errors.length,
      0,
      "the workflow layer made no second report",
    );
  });

  test("a failure no vendor layer recognised IS reported by the workflow layer", async () => {
    const original = new Error("Lead with ID 41 not found.");
    await reportWorkflowError("extractProject", rebuiltByTheRuntime(original));
    assert.equal(reported.errors.length, 1);
    assert.equal(reported.errors[0].context.source, "workflow:extractProject");
  });

  test("a vendor failure that was NOT reported (a 404) is left for the workflow", async () => {
    // reportExternalError drops a 404, so nothing marked the stack, and the run
    // that died of it is still an incident.
    const original = Object.assign(new Error("Graph error 404"), {
      status: 404,
    });
    await insideAStep(() =>
      reportExternalError("graph", "get message", original),
    );
    assert.equal(original.stack?.includes(REPORTED_STACK_MARKER), false);
    await reportWorkflowError(
      "processInboundLead",
      rebuiltByTheRuntime(original),
    );
    assert.equal(reported.errors.length, 1);
  });
});

describe("the stack marker", () => {
  test("is added only inside a step, after the report, and only once", async () => {
    const outside = new Error("outside");
    carryReportAcrossSteps(outside);
    assert.equal(outside.stack?.includes(REPORTED_STACK_MARKER), false);

    const inside = new Error("inside");
    await insideAStep(() => {
      carryReportAcrossSteps(inside);
      carryReportAcrossSteps(inside);
    });
    assert.equal(
      inside.stack?.split(REPORTED_STACK_MARKER).length,
      2,
      "exactly one marker",
    );
  });

  test("is a line no stack parser reads as a frame", () => {
    assert.doesNotMatch(REPORTED_STACK_MARKER, /^\s*at\s/);
  });

  test("survives the runtime rebuild, which is the whole point", async () => {
    const original = new Error("boom");
    await insideAStep(() => carryReportAcrossSteps(original));
    assert.ok(
      rebuiltByTheRuntime(original).stack?.includes(REPORTED_STACK_MARKER),
    );
  });

  test("a frozen error or a primitive does not throw", async () => {
    await insideAStep(() => {
      assert.doesNotThrow(() =>
        carryReportAcrossSteps(Object.freeze(new Error("x"))),
      );
      assert.doesNotThrow(() => carryReportAcrossSteps("a string"));
      assert.doesNotThrow(() => carryReportAcrossSteps(undefined));
    });
  });

  test("outside a step the detection is false", () => {
    assert.equal(inWorkflowStep(), false);
  });
});

describe("failureSignature — what groups failures of one workflow", () => {
  test("the same cause with different ids is one signature", () => {
    assert.equal(
      failureSignature("Lead with ID 41 not found."),
      failureSignature("Lead with ID 97 not found."),
    );
  });

  test("different causes are different signatures", () => {
    assert.notEqual(
      failureSignature("Lead with ID 41 not found."),
      failureSignature("Graph error 503: gateway timeout"),
    );
  });

  test("an address or phone number in the message never reaches the signature", () => {
    // The signature is the fingerprint, which is stored with the issue.
    for (const message of [
      "Graph 503 for bob@example.com",
      "Could not reach 0412 345 678",
    ]) {
      const signature = failureSignature(message);
      assert.ok(!/bob|example|0412|345/.test(signature), signature);
    }
    assert.equal(
      failureSignature("Graph 503 for bob@example.com"),
      failureSignature("Graph 503 for jane@other.org"),
      "and different people still group as one cause",
    );
  });

  test("uuids and quoted values are taken out; only the first line counts", () => {
    assert.equal(
      failureSignature(
        'Could not store "plans v2.pdf" for 3f2b8c1e-9a4d-4e1b-8c7a-1d2e3f4a5b6c\nat x',
      ),
      "could not store … for #",
    );
  });
});

describe("the reporting step", () => {
  test("rebuilds the error and reports it under the workflow's name", async () => {
    await reportWorkflowFailure("syncSentMail", {
      name: "FatalError",
      message: "Graph error 503 for list 12",
      stack: "at somewhere",
    });
    assert.equal(reported.errors.length, 1);
    const { error, context } = reported.errors[0];
    assert.equal(error.name, "FatalError");
    assert.equal(error.stack, "at somewhere");
    assert.equal(context.source, "workflow:syncSentMail");
    // One issue per workflow and cause, not one per input message.
    assert.deepEqual(context.fingerprint, [
      "workflow",
      "syncSentMail",
      "graph error # for list #",
    ]);
  });

  test("is never retried: a retry loop around a reporter spends the quota", () => {
    assert.equal(reportWorkflowFailure.maxRetries, 0);
  });

  test("reportWorkflowError reports a failure and stays silent on a cancellation", async () => {
    await reportWorkflowError("processInboundLead", new Error("db down"));
    assert.equal(reported.errors.length, 1);

    const cancelled = new Error("cancelled");
    cancelled.name = "WorkflowRunCancelledError";
    await reportWorkflowError("processInboundLead", cancelled);
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
