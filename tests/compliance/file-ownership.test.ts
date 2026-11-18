import assert from "node:assert/strict";
import { describe, test } from "vitest";

import { requireProjectComplianceFile } from "@/lib/domain/compliance/file-ownership";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
} from "@/lib/domain/errors";

import { recordingDb } from "../architecture/domain-harness";

// A compliance upload may only attach a file that is this project's: uploaded
// to it, or received by email onto its compliance file (those carry no
// projectId, only the compliance document they landed on).

const input = { projectId: "p_1", fileId: "f_1" };
const found = { id: "f_1", filename: "CDC.pdf", url: "https://blob/cdc.pdf" };

describe("requireProjectComplianceFile", () => {
  test("accepts a file uploaded to the project or received on its file", async () => {
    const recorder = recordingDb({ "file.findFirst": found });
    assert.deepEqual(
      await requireProjectComplianceFile(input, recorder.db),
      found,
    );
    assert.deepEqual(recorder.calls[0].args, {
      where: {
        id: "f_1",
        OR: [
          { projectId: "p_1" },
          { complianceDocument: { engagement: { projectId: "p_1" } } },
        ],
      },
      select: { id: true, filename: true, url: true },
    });
  });

  test("refuses another project's file", async () => {
    const recorder = recordingDb({
      "file.findFirst": null,
      "file.findUnique": { id: "f_1" },
    });
    await assert.rejects(
      requireProjectComplianceFile(input, recorder.db),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a missing file is not found", async () => {
    const recorder = recordingDb({
      "file.findFirst": null,
      "file.findUnique": null,
    });
    await assert.rejects(
      requireProjectComplianceFile(input, recorder.db),
      (error: unknown) =>
        error instanceof DomainNotFoundError
        && error.message === "File f_1 not found.",
    );
  });
});
