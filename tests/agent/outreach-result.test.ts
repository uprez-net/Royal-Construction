import assert from "node:assert/strict";
import { test } from "vitest";

import { describeOutreachResult } from "@/agent/lib/project-operations";

// The domain answers `alreadySent` when it ignored the request because the
// party already had an outreach thread. The adapter used to say "sent to <the
// earlier contact>" regardless, so a request for a different address was
// reported as done and nobody was emailed (#366).

test("a real send says so, with the attachment count", () => {
  const out = describeOutreachResult({
    alreadySent: false,
    attachmentCount: 2,
    recipient: "surveyor@example.com",
  });

  assert.equal(out.title, "Compliance outreach sent");
  assert.match(out.summary, /sent to surveyor@example\.com with 2 attachments/);
  assert.equal(out.warnings, undefined);
});

test("an outreach that was already out is not reported as sent", () => {
  const out = describeOutreachResult({
    alreadySent: true,
    attachmentCount: 0,
    recipient: "first@example.com",
  });

  assert.equal(out.title, "Compliance outreach already sent");
  assert.match(out.summary, /already contacted \(first@example\.com\)/);
  assert.match(out.summary, /nothing was sent/);
  assert.doesNotMatch(out.summary, /Outreach sent to/);
});

test("a request for a different address says that address was not emailed", () => {
  const out = describeOutreachResult(
    { alreadySent: true, attachmentCount: 0, recipient: "first@example.com" },
    "second@example.com",
  );

  assert.deepEqual(out.warnings, [
    "second@example.com was NOT emailed. The earlier outreach went to first@example.com.",
  ]);
});

test("a replay of the same address is not called a different one", () => {
  const out = describeOutreachResult(
    { alreadySent: true, attachmentCount: 0, recipient: "First@Example.com" },
    " first@example.com",
  );

  assert.equal(out.warnings, undefined);
});
