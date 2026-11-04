import assert from "node:assert/strict";
import { test } from "vitest";

import {
  previewInvoiceRecheckSchema,
  sendInvoiceRecheckSchema,
} from "@/utils/validators/tradie-invoices";

// The recheck Server Actions are POST endpoints anyone signed in can call
// with any arguments. These are what stand between that and the domain: a
// malformed call is refused with a sentence, not a TypeError and a blank 500.

const ids = { projectId: "project-1", scheduleId: "schedule-1" };

test("preview needs a project and a booking", () => {
  assert.equal(previewInvoiceRecheckSchema.safeParse(ids).success, true);
  assert.equal(
    previewInvoiceRecheckSchema.safeParse({ ...ids, scheduleId: " " }).success,
    false,
  );
  assert.equal(
    previewInvoiceRecheckSchema.safeParse({ projectId: 7, scheduleId: "s" })
      .success,
    false,
  );
});

test("send also needs a non-empty attempt key, trimmed", () => {
  const ok = sendInvoiceRecheckSchema.safeParse({
    ...ids,
    attemptKey: " attempt-1 ",
  });
  assert.equal(ok.success, true);
  assert.equal(ok.data?.attemptKey, "attempt-1");
  for (const attemptKey of [undefined, "", "   ", 42, null]) {
    assert.equal(
      sendInvoiceRecheckSchema.safeParse({ ...ids, attemptKey }).success,
      false,
      `attemptKey ${JSON.stringify(attemptKey)} should be refused`,
    );
  }
});
