import assert from "node:assert/strict";
import { test } from "vitest";
import { Role } from "@prisma/client";
import { completeProjectFileUpload, saveFile } from "@/lib/domain/files";
import { attachMilestonePhotos } from "@/lib/domain/projects/milestones";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainSideEffectError,
} from "@/lib/domain/errors";
import { recordingDb } from "../architecture/domain-harness";

const admin = { kind: "user" as const, userId: "u_1", role: Role.ADMIN };
const input = {
  projectId: "p_1",
  milestoneId: "m_1",
  fileId: "f_1",
  fileName: "site.photo.jpg",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/projects/p_1/milestones/m_1/f_1-site.photo-AbC123.jpg",
};
const blob = {
  url: input.fileUrl,
  pathname: "projects/p_1/milestones/m_1/f_1-site.photo-AbC123.jpg",
  contentType: "image/jpeg",
  size: 123,
};
const saved = {
  id: input.fileId,
  projectId: "p_1",
  milestoneId: "m_1",
  leadId: null,
  uploadedBy: "u_1",
  url: input.fileUrl,
};
const reads = {
  "user.findUnique": { id: "u_1", role: Role.ADMIN, customerId: null },
  "milestone.findUnique": {
    id: "m_1",
    projectId: "p_1",
    project: { id: "p_1", siteManagerId: null },
  },
  "project.findUnique": { id: "p_1", customerId: "c_1", siteManagerId: null },
};

test("browser confirmation persists a file before attachment without waiting for the callback", async () => {
  let persisted = false;
  const recorder = recordingDb({
    ...reads,
    "file.findUnique": () => (persisted ? saved : null),
    "file.create": () => {
      persisted = true;
      return saved;
    },
    "file.findMany": () => (persisted ? [{ id: input.fileId }] : []),
    "milestone.update": { id: "m_1", name: "Slab" },
  });
  await completeProjectFileUpload(admin, input, recorder.db, async () => blob);
  await attachMilestonePhotos(
    admin,
    { milestoneId: "m_1", fileIds: [input.fileId] },
    recorder.db,
  );
  // A delayed completion callback is a replay, not a second File insert.
  await saveFile(
    admin,
    {
      ...input,
      userId: "u_1",
      fileType: blob.contentType,
      fileSize: blob.size,
    },
    recorder.db,
  );
  assert.equal(
    recorder.writes().filter((write) => write.operation === "file.create")
      .length,
    1,
  );
  assert.equal(recorder.writes()[1].operation, "milestone.update");
  const create = recorder.writes()[0].args as {
    data: { filesize: number; storagePath: string };
  };
  assert.equal(create.data.filesize, blob.size);
  assert.equal(create.data.storagePath, blob.pathname);
});

test("confirmation reuses the File row when the callback arrived first", async () => {
  const recorder = recordingDb({ ...reads, "file.findUnique": saved });
  assert.deepEqual(
    await completeProjectFileUpload(
      admin,
      input,
      recorder.db,
      async () => blob,
    ),
    saved,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("confirmation also supports an update without a milestone and a spaced filename", async () => {
  const upload = {
    ...input,
    milestoneId: null,
    fileName: " site photo.jpg ",
    fileUrl:
      "https://store.public.blob.vercel-storage.com/projects/p_1/f_1--site-photo-AbC123.jpg-",
  };
  const storedBlob = {
    ...blob,
    url: upload.fileUrl,
    pathname: "projects/p_1/f_1--site-photo-AbC123.jpg-",
  };
  const recorder = recordingDb({
    ...reads,
    "file.findUnique": null,
    "file.create": { ...saved, milestoneId: null, url: upload.fileUrl },
  });
  // With a trailing space the sanitized extension is .jpg-, and Blob places
  // the random suffix before that extension just as it does for .jpg.
  await completeProjectFileUpload(
    admin,
    upload,
    recorder.db,
    async () => storedBlob,
  );
  const create = recorder.writes()[0].args as {
    data: { filename: string; milestoneId: string | null };
  };
  assert.equal(create.data.filename, upload.fileName);
  assert.equal(create.data.milestoneId, null);
});

test("a callback racing confirmation can replay only the exact same upload", async () => {
  let lookups = 0;
  const recorder = recordingDb({
    ...reads,
    "file.findUnique": () => (++lookups === 1 ? null : saved),
    "file.create": () => {
      throw { code: "P2002" };
    },
  });
  assert.deepEqual(
    await completeProjectFileUpload(
      admin,
      input,
      recorder.db,
      async () => blob,
    ),
    saved,
  );
});

test("a reused file ID never replaces another project's file", async () => {
  const recorder = recordingDb({
    ...reads,
    "file.findUnique": { ...saved, projectId: "p_other" },
  });
  await assert.rejects(
    () =>
      completeProjectFileUpload(admin, input, recorder.db, async () => blob),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

for (const milestoneId of ["m_other", null]) {
  test(`a reused file ID refuses a different milestone scope: ${milestoneId}`, async () => {
    const recorder = recordingDb({
      ...reads,
      "file.findUnique": { ...saved, milestoneId },
    });
    await assert.rejects(
      () =>
        saveFile(
          admin,
          {
            ...input,
            userId: admin.userId,
            fileType: blob.contentType,
            fileSize: blob.size,
          },
          recorder.db,
        ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
}

test("a project-wide upload cannot replay an existing milestone upload", async () => {
  const recorder = recordingDb({ ...reads, "file.findUnique": saved });
  await assert.rejects(
    () =>
      saveFile(
        admin,
        {
          ...input,
          milestoneId: undefined,
          userId: admin.userId,
          fileType: blob.contentType,
          fileSize: blob.size,
        },
        recorder.db,
      ),
    DomainAuthorizationError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("a callback racing confirmation cannot replay a different milestone", async () => {
  let lookups = 0;
  const recorder = recordingDb({
    ...reads,
    "file.findUnique": () =>
      ++lookups === 1 ? null : { ...saved, milestoneId: "m_other" },
    "file.create": () => {
      throw { code: "P2002" };
    },
  });
  await assert.rejects(
    () =>
      completeProjectFileUpload(admin, input, recorder.db, async () => blob),
    DomainAuthorizationError,
  );
  assert.deepEqual(
    recorder.writes().map((write) => write.operation),
    ["file.create"],
  );
});

for (const pathname of [
  "projects/p_other/milestones/m_1/f_1-site.photo-AbC123.jpg",
  "projects/p_1/milestones/m_other/f_1-site.photo-AbC123.jpg",
  "projects/p_1/milestones/m_1/f_other-site.photo-AbC123.jpg",
  "projects/p_1/milestones/m_1/f_1-siteXphoto-AbC123.jpg",
]) {
  test(`confirmation refuses a mismatched Blob path: ${pathname}`, async () => {
    const recorder = recordingDb(reads);
    await assert.rejects(
      () =>
        completeProjectFileUpload(admin, input, recorder.db, async () => ({
          ...blob,
          pathname,
        })),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
}

test("storage verification failure never records success", async () => {
  const recorder = recordingDb(reads);
  await assert.rejects(
    () =>
      completeProjectFileUpload(admin, input, recorder.db, async () => {
        throw new Error("offline");
      }),
    DomainSideEffectError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("unauthorized callers are refused before storage is inspected", async () => {
  const recorder = recordingDb(reads);
  let inspected = false;
  await assert.rejects(
    () =>
      completeProjectFileUpload(
        { kind: "anonymous", source: "test" },
        input,
        recorder.db,
        async () => {
          inspected = true;
          return blob;
        },
      ),
    DomainAuthorizationError,
  );
  assert.equal(inspected, false);
  assert.deepEqual(recorder.writes(), []);
});
