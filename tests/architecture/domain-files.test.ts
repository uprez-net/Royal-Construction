import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { test } from "node:test";

import { saveFile } from "../../lib/domain/files";
import { DomainAuthorizationError, DomainNotFoundError } from "../../lib/domain/errors";
import { recordingDb } from "./domain-harness";

const admin = { kind: "user" as const, role: Role.ADMIN, userId: "u_1" };
const customer = {
  kind: "user" as const,
  role: Role.CUSTOMER,
  userId: "u_customer",
};

const input = {
  fileName: "plan.pdf",
  fileSize: 12,
  fileType: "application/pdf",
  fileUrl: "https://blob.test/plan.pdf",
  projectId: "p_1",
  userId: "u_1",
};

test("a file cannot be attributed to a different signed-in user", async () => {
  await assert.rejects(
    () => saveFile(admin, { ...input, userId: "u_other" }, recordingDb().db),
    DomainAuthorizationError,
  );
});

test("saving a project file rechecks the target through the shared attach rule", async () => {
  const recorder = recordingDb({
    "user.findUnique": { customerId: null, id: "u_1", role: Role.ADMIN },
    "project.findUnique": { customerId: "c_1" },
    "file.create": { id: "f_1" },
  });

  await saveFile(admin, input, recorder.db);
  const write = recorder.writes()[0];
  assert.equal(write.operation, "file.create");
  assert.equal(
    (write.args as { data: Record<string, unknown> }).data.uploadedBy,
    "u_1",
  );
});

test("a customer cannot attach a file to somebody else's project", async () => {
  const recorder = recordingDb({
    "user.findUnique": {
      customerId: "c_customer",
      id: "u_customer",
      role: Role.CUSTOMER,
    },
    "project.findUnique": { customerId: "c_other" },
  });

  await assert.rejects(
    () => saveFile(customer, { ...input, userId: "u_customer" }, recorder.db),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a missing uploader is a hard failure, never a successful File write", async () => {
  await assert.rejects(
    () => saveFile(admin, input, recordingDb({ "user.findUnique": null }).db),
    DomainNotFoundError,
  );
});
