import assert from "node:assert/strict";
import { test } from "vitest";
import { Role } from "@prisma/client";
import { deleteProjectFile } from "@/lib/domain/projects/files";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { recordingDb } from "../architecture/domain-harness";

const admin = { kind: "user" as const, role: Role.ADMIN, userId: "u_1" };
const input = { projectId: "p_1", fileId: "f_1" };
const file = {
  id: "f_1",
  projectId: "p_1",
  leadId: null,
  milestoneId: "m_1",
  complianceDocumentId: null,
  incidentId: null,
  filename: "photo.jpg",
  url: "https://store.public.blob.vercel-storage.com/projects/p_1/photo.jpg",
  storagePath: "projects/p_1/photo.jpg",
};
const reads = {
  "project.findUnique": { id: "p_1", siteManagerId: null },
  "file.findFirst": file,
  "siteUpdate.findMany": [{ id: "s_1", photoUrls: [file.url, "keep.jpg"] }],
  "certifierEngagement.findUnique": { id: "e_1" },
  "certifierEmail.findMany": [],
  "file.findMany": [],
};

test("deleting a project file removes its photo references and records the actor", async () => {
  const recorder = recordingDb(reads);
  const deleted: unknown[] = [];
  const result = await deleteProjectFile(
    admin,
    input,
    recorder.transactionalDb,
    async (urls) => {
      deleted.push(urls);
    },
  );
  assert.equal(result.storageCleanupFailed, false);
  assert.deepEqual(deleted, [[file.url]]);
  assert.deepEqual(recorder.writes()[0], {
    operation: "siteUpdate.update",
    args: { where: { id: "s_1" }, data: { photoUrls: ["keep.jpg"] } },
  });
  assert.equal(recorder.writes()[1].operation, "file.delete");
  const audit = recorder.writes()[2].args as { data: { authorId: string } };
  assert.equal(audit.data.authorId, admin.userId);
});

test("a forged project/file pair deletes nothing", async () => {
  const recorder = recordingDb({ ...reads, "file.findFirst": null });
  let deleted = false;
  await assert.rejects(
    () =>
      deleteProjectFile(admin, input, recorder.transactionalDb, async () => {
        deleted = true;
      }),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
  assert.equal(deleted, false);
  assert.deepEqual(recorder.calls[1].args, {
    where: { id: "f_1", projectId: "p_1" },
  });
});

test("a customer cannot delete a project document", async () => {
  const recorder = recordingDb();
  await assert.rejects(
    () =>
      deleteProjectFile(
        { ...admin, role: Role.CUSTOMER },
        input,
        recorder.transactionalDb,
        async () => {
          assert.fail("storage must not be called");
        },
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

for (const association of ["complianceDocumentId", "incidentId"]) {
  test(`a file used by ${association} must be managed through its owning record`, async () => {
    const recorder = recordingDb({
      ...reads,
      "file.findFirst": { ...file, [association]: "linked_1" },
    });
    await assert.rejects(
      () =>
        deleteProjectFile(admin, input, recorder.transactionalDb, async () => {
          assert.fail("storage must not be called");
        }),
      DomainValidationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
}

test("removing a lead document from the project preserves its lead copy", async () => {
  const recorder = recordingDb({
    ...reads,
    "file.findFirst": { ...file, leadId: 12 },
  });
  await deleteProjectFile(admin, input, recorder.transactionalDb, async () => {
    assert.fail("the lead still uses storage");
  });
  assert.deepEqual(recorder.writes()[1], {
    operation: "file.update",
    args: {
      where: { id: "f_1" },
      data: { projectId: null, milestoneId: null },
    },
  });
});

test("storage shared by a surviving File record is preserved", async () => {
  const recorder = recordingDb({
    ...reads,
    "file.findMany": [{ url: file.url }],
  });
  await deleteProjectFile(admin, input, recorder.transactionalDb, async () => {
    assert.fail("shared storage must survive");
  });
  assert.equal(recorder.writes()[1].operation, "file.delete");
});

test("storage cleanup failure is reported separately from the committed removal", async () => {
  const recorder = recordingDb(reads);
  const result = await deleteProjectFile(
    admin,
    input,
    recorder.transactionalDb,
    async () => {
      throw new Error("storage unavailable");
    },
  );
  assert.equal(result.storageCleanupFailed, true);
  assert.equal(recorder.writes()[1].operation, "file.delete");
});
