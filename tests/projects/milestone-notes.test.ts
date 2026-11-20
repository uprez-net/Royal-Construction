import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  DomainAuthorizationError,
  DomainNotFoundError,
  DomainValidationError,
} from "@/lib/domain/errors";
import { systemPrincipal } from "@/lib/domain/principal";
import {
  MILESTONE_NOTE_MAX_LENGTH,
  canDeleteMilestoneNote,
  canSeeMilestoneNotes,
} from "@/lib/domain/projects/milestone-note-rules";
import {
  addMilestoneNote,
  deleteMilestoneNote,
} from "@/lib/domain/projects/milestone-notes";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

const PROJECT = {
  id: "project_1",
  location: "Parramatta",
  name: "Smith residence",
  siteManagerId: "user_site_manager",
};

/** A milestone on PROJECT, and whatever else the case needs. */
function db(extra: Record<string, unknown> = {}) {
  return recordingDb({
    "milestone.findUnique": { projectId: PROJECT.id },
    "project.findUnique": PROJECT,
    "milestoneNote.create": (args: unknown) => ({
      id: "note_1",
      createdAt: new Date("2026-11-06T01:00:00Z"),
      author: { id: "user_admin", name: "Office" },
      ...(args as { data: object }).data,
    }),
    ...extra,
  });
}

describe("who sees notes", () => {
  test("staff and the system do, a customer does not", () => {
    assert.equal(canSeeMilestoneNotes(adminPrincipal()), true);
    assert.equal(canSeeMilestoneNotes(siteManagerPrincipal()), true);
    assert.equal(canSeeMilestoneNotes(systemPrincipal("cron")), true);
    assert.equal(canSeeMilestoneNotes(customerPrincipal()), false);
  });

  test("an admin deletes anyone's note, a site manager only their own", () => {
    const theirs = { authorId: "user_someone_else" };
    const own = { authorId: "user_site_manager" };
    assert.equal(canDeleteMilestoneNote(adminPrincipal(), theirs), true);
    assert.equal(canDeleteMilestoneNote(siteManagerPrincipal(), theirs), false);
    assert.equal(canDeleteMilestoneNote(siteManagerPrincipal(), own), true);
    // A note whose author's account is gone belongs to nobody but an admin.
    assert.equal(
      canDeleteMilestoneNote(siteManagerPrincipal(), { authorId: null }),
      false,
    );
    assert.equal(
      canDeleteMilestoneNote(systemPrincipal("cron"), theirs),
      false,
    );
  });
});

describe("addMilestoneNote", () => {
  test("stores the trimmed note against the signed-in author", async () => {
    const recorder = db();
    const note = await addMilestoneNote(
      adminPrincipal(),
      { milestoneId: "milestone_1", body: "  Council moved the inspection.  " },
      recorder.db,
    );
    assert.equal(note.body, "Council moved the inspection.");
    assert.deepEqual(
      recorder.writes().map((call) => call.args),
      [
        {
          data: {
            milestoneId: "milestone_1",
            authorId: "user_admin",
            body: "Council moved the inspection.",
          },
          select: (recorder.writes()[0].args as { select: unknown }).select,
        },
      ],
    );
  });

  for (const [label, principal] of [
    ["a customer", customerPrincipal()],
    ["the system, which has nobody to attribute it to", systemPrincipal("x")],
  ] as const) {
    test(`refuses ${label} and writes nothing`, async () => {
      const recorder = db();
      await assert.rejects(
        addMilestoneNote(
          principal,
          { milestoneId: "milestone_1", body: "hello" },
          recorder.db,
        ),
        DomainAuthorizationError,
      );
      assert.deepEqual(recorder.writes(), []);
    });
  }

  test("lets any site manager record a note, not only the assigned one", async () => {
    // Owner, 2026-11-20: site managers record on every project.
    const recorder = db();
    await addMilestoneNote(
      siteManagerPrincipal("user_other_manager"),
      { milestoneId: "milestone_1", body: "hello" },
      recorder.db,
    );
    assert.ok(recorder.writes().length > 0);
  });

  test("refuses a customer and writes nothing", async () => {
    const recorder = db();
    await assert.rejects(
      addMilestoneNote(
        customerPrincipal(),
        { milestoneId: "milestone_1", body: "hello" },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  for (const [label, body] of [
    ["an empty note", "   \n "],
    ["a note over the cap", "x".repeat(MILESTONE_NOTE_MAX_LENGTH + 1)],
  ] as const) {
    test(`refuses ${label} and writes nothing`, async () => {
      const recorder = db();
      await assert.rejects(
        addMilestoneNote(
          adminPrincipal(),
          { milestoneId: "milestone_1", body },
          recorder.db,
        ),
        DomainValidationError,
      );
      assert.deepEqual(recorder.writes(), []);
    });
  }

  test("refuses an activity that does not exist", async () => {
    const recorder = db({ "milestone.findUnique": null });
    await assert.rejects(
      addMilestoneNote(
        adminPrincipal(),
        { milestoneId: "gone", body: "hello" },
        recorder.db,
      ),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.writes(), []);
  });
});

describe("deleteMilestoneNote", () => {
  const note = (authorId: string | null) => ({
    "milestoneNote.findUnique": {
      id: "note_1",
      milestoneId: "milestone_1",
      authorId,
    },
  });

  test("an admin deletes a colleague's note", async () => {
    const recorder = db(note("user_someone_else"));
    const result = await deleteMilestoneNote(
      adminPrincipal(),
      { milestoneId: "milestone_1", noteId: "note_1" },
      recorder.db,
    );
    assert.deepEqual(result, { id: "note_1", milestoneId: "milestone_1" });
    assert.deepEqual(recorder.writes(), [
      {
        operation: "milestoneNote.deleteMany",
        args: { where: { id: "note_1" } },
      },
    ]);
  });

  test("a site manager cannot delete a colleague's note", async () => {
    const recorder = db(note("user_someone_else"));
    await assert.rejects(
      deleteMilestoneNote(
        siteManagerPrincipal(),
        { milestoneId: "milestone_1", noteId: "note_1" },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a customer cannot delete one, and is not told whether it exists", async () => {
    const recorder = db(note("user_customer"));
    await assert.rejects(
      deleteMilestoneNote(
        customerPrincipal(),
        { milestoneId: "milestone_1", noteId: "note_1" },
        recorder.db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(recorder.operations(), []);
  });

  test("a note on another activity is answered as not found", async () => {
    const recorder = db(note("user_admin"));
    await assert.rejects(
      deleteMilestoneNote(
        adminPrincipal(),
        { milestoneId: "milestone_2", noteId: "note_1" },
        recorder.db,
      ),
      DomainNotFoundError,
    );
    assert.deepEqual(recorder.writes(), []);
  });

  test("a second click after the first deleted it is not found, not a 500", async () => {
    const recorder = db({
      ...note("user_admin"),
      "milestoneNote.deleteMany": { count: 0 },
    });
    await assert.rejects(
      deleteMilestoneNote(
        adminPrincipal(),
        { milestoneId: "milestone_1", noteId: "note_1" },
        recorder.db,
      ),
      DomainNotFoundError,
    );
  });
});
