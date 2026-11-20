import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

import { REPO_ROOT } from "../support/repo-root";

// The booking page's availability read is public (proxy.ts). A booked
// consultation's subject is "Consultation with <client> - Royal
// Constructions", so the subject must never be read or returned (#567).
const source = readFileSync(
  path.join(REPO_ROOT, "app/api/graph/read-calender-dateTime/route.ts"),
  "utf8",
);

describe("public calendar read (#567)", () => {
  it("asks Graph for times only", () => {
    const select = source.match(/\$select=([^&`]+)/)?.[1];
    assert.equal(select, "start,end,isAllDay");
  });

  it("returns no subject", () => {
    assert.doesNotMatch(source, /subject:/);
  });

  it("clamps the window it reads", () => {
    assert.match(
      source,
      /Math\.min\(Math\.max\(requestedDays, 1\), MAX_DAYS\)/,
    );
    assert.match(source, /const MAX_DAYS = 90;/);
  });
});
