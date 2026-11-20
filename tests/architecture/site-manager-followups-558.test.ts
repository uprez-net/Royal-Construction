import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Role, WhatsAppMediaStatus } from "@prisma/client";
import { describe, test } from "vitest";

import { authorizeComplianceMutation } from "@/lib/domain/access/compliance";
import { assertCanReadTradieDirectory } from "@/lib/domain/access/tradies";
import { DomainAuthorizationError } from "@/lib/domain/errors";
import { canReadFile } from "@/lib/domain/files";
import { decideVariation } from "@/lib/domain/projects/variations";
import { retryWhatsAppMedia } from "@/lib/domain/whatsapp/media";
import { REPO_ROOT } from "../support/repo-root";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Issue #558. Route authorization gaps found by the site-manager audit. Each
// rule now lives in lib/domain (or lib/compliance's adapter over it); the
// routes only call it. The behavioural tests drive the rule through a
// recording database; the static ones pin what a route is wired to, because a
// route has no test harness of its own here.

const SM_ID = "user_site_manager";
const ADMIN_ID = "user_admin";

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

describe("WhatsApp media retry follows the owning thread", () => {
  test("a site manager cannot requeue a prospect's lead-thread file", async () => {
    const { db, operations } = recordingDb({
      "whatsAppMedia.findUnique": {
        id: "m_1",
        projectMessage: null,
        status: WhatsAppMediaStatus.FAILED,
      },
    });
    await assert.rejects(
      retryWhatsAppMedia(siteManagerPrincipal(SM_ID), { mediaId: "m_1" }, db),
      DomainAuthorizationError,
    );
    assert.deepEqual(
      operations().filter((op) => op.startsWith("whatsAppMedia.update")),
      [],
    );
  });

  test("a refused caller gets the same refusal whatever state the file is in", async () => {
    const { db, writes } = recordingDb({
      "whatsAppMedia.findUnique": {
        id: "m_1",
        projectMessage: null,
        status: WhatsAppMediaStatus.STORED,
      },
    });
    await assert.rejects(
      retryWhatsAppMedia(siteManagerPrincipal(SM_ID), { mediaId: "m_1" }, db),
      DomainAuthorizationError,
    );
    assert.equal(writes().length, 0);
  });

  test("an admin can requeue a lead-thread file", async () => {
    const { db, writes } = recordingDb({
      "whatsAppMedia.findUnique": {
        id: "m_1",
        projectMessage: null,
        status: WhatsAppMediaStatus.FAILED,
      },
    });
    await retryWhatsAppMedia(adminPrincipal(ADMIN_ID), { mediaId: "m_1" }, db);
    assert.equal(writes().length, 1);
  });

  test("a site manager can requeue a project-group file on any project", async () => {
    const { db, writes } = recordingDb({
      "whatsAppMedia.findUnique": {
        id: "m_2",
        projectMessage: { projectId: "p_1" },
        status: WhatsAppMediaStatus.FAILED,
      },
      "project.findUnique": {
        id: "p_1",
        location: "1 Example Street",
        name: "Example",
        siteManagerId: "someone_else",
      },
    });
    await retryWhatsAppMedia(
      siteManagerPrincipal(SM_ID),
      { mediaId: "m_2" },
      db,
    );
    assert.equal(writes().length, 1);
  });
});

describe("Variation decisions are the office's money", () => {
  test("a site manager assigned to the project is refused before any read", async () => {
    const { db, operations } = recordingDb();
    await assert.rejects(
      decideVariation(
        siteManagerPrincipal(SM_ID),
        { decision: "APPROVED", projectId: "p_1", variationId: "v_1" },
        db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(operations(), []);
  });
});

describe("File reads follow the record the file sits on", () => {
  const sitePhoto = {
    complianceDocument: null,
    leadId: null,
    project: {
      Lead: null,
      customerId: "c_1",
      siteManagerId: SM_ID,
    },
    uploadedBy: "someone_else",
  };

  test("a site manager may open a photo on a project they run", () => {
    assert.equal(canReadFile(siteManagerPrincipal(SM_ID), sitePhoto), true);
  });

  test("a site manager may open a build document on their own project", () => {
    assert.equal(
      canReadFile(siteManagerPrincipal(SM_ID), {
        ...sitePhoto,
        complianceDocument: { documentType: "SURVEY" },
      }),
      true,
    );
  });

  test("a site manager may not open the rest of the compliance file", () => {
    assert.equal(
      canReadFile(siteManagerPrincipal(SM_ID), {
        ...sitePhoto,
        complianceDocument: { documentType: "HOME_INSURANCE" },
      }),
      false,
    );
  });

  test("a site manager may not open a build document on someone else's project", () => {
    assert.equal(
      canReadFile(siteManagerPrincipal(SM_ID), {
        ...sitePhoto,
        complianceDocument: { documentType: "SURVEY" },
        project: { ...sitePhoto.project, siteManagerId: "someone_else" },
      }),
      false,
    );
  });

  test("a site manager may not open a lead's file, even one linked to their project", () => {
    assert.equal(
      canReadFile(siteManagerPrincipal(SM_ID), { ...sitePhoto, leadId: 7 }),
      false,
    );
  });

  test("a site manager may not open a lead's file, even one they uploaded", () => {
    assert.equal(
      canReadFile(siteManagerPrincipal(SM_ID), {
        ...sitePhoto,
        leadId: 7,
        uploadedBy: SM_ID,
        project: null,
      }),
      false,
    );
  });

  test("the matching customer may open their own compliance file", () => {
    assert.equal(
      canReadFile(
        {
          customerId: "c_1",
          kind: "user",
          role: Role.CUSTOMER,
          userId: "user_customer",
        },
        {
          complianceDocument: { documentType: "SURVEY" },
          leadId: null,
          project: { Lead: null, customerId: "c_1", siteManagerId: null },
          uploadedBy: "user_customer",
        },
      ),
      true,
    );
  });

  test("an admin may open a lead's file", () => {
    assert.equal(
      canReadFile(adminPrincipal(ADMIN_ID), {
        ...sitePhoto,
        leadId: 7,
        project: null,
      }),
      true,
    );
  });
});

describe("The tradie directory is staff only", () => {
  test("a customer is refused the directory", () => {
    assert.throws(
      () => assertCanReadTradieDirectory(customerPrincipal()),
      DomainAuthorizationError,
    );
  });

  test("a site manager may read the directory", () => {
    assert.doesNotThrow(() =>
      assertCanReadTradieDirectory(siteManagerPrincipal(SM_ID)),
    );
  });
});

describe("Compliance sends and AI runs are staff only", () => {
  const project = {
    certifierEngagement: { id: "e_1", status: "OPEN" },
    customerId: "c_1",
    id: "p_1",
    Lead: null,
    location: "1 Example Street",
    siteManagerId: SM_ID,
  };

  test("the matching customer is refused before any read", async () => {
    const { db, operations } = recordingDb();
    await assert.rejects(
      authorizeComplianceMutation(
        customerPrincipal("user_customer"),
        "p_1",
        db,
      ),
      DomainAuthorizationError,
    );
    assert.deepEqual(operations(), []);
  });

  test("a site manager on the project is refused the compliance file", async () => {
    const { db } = recordingDb({ "project.findUnique": project });
    await assert.rejects(
      authorizeComplianceMutation(siteManagerPrincipal(SM_ID), "p_1", db),
      DomainAuthorizationError,
    );
  });

  test("an admin may send", async () => {
    const { db } = recordingDb({ "project.findUnique": project });
    const result = await authorizeComplianceMutation(
      adminPrincipal(ADMIN_ID),
      "p_1",
      db,
    );
    assert.equal(result.engagement?.id, "e_1");
  });

  test("the nine send and AI routes use the staff guard, not the file guard", () => {
    const routes = [
      "outreach",
      "review",
      "signed-copies",
      "reply",
      "early-review",
      "developer/resend",
      "parties/reply",
      "alerts/[alertId]/follow-up",
      "discover",
    ];
    for (const route of routes) {
      const source = read(
        `app/api/(data)/projects/[projectId]/compliance/${route}/route.ts`,
      );
      assert.match(source, /requireComplianceMutation\(/, route);
      assert.doesNotMatch(source, /requireComplianceAccess/, route);
    }
  });
});

describe("Routes are wired to the rules above", () => {
  test("the lead-note AI editor refuses anyone who is not the office", () => {
    const source = read("app/api/leads/notes/ai/route.ts");
    assert.match(source, /!isOfficeRole\(user\.role\)/);
    assert.match(source, /jsonError\("Forbidden", 403\)/);
  });

  test("the AI writing assist refuses a client account", () => {
    const source = read("app/api/ai/route.ts");
    assert.match(source, /!isInternalRole\(user\.role\)/);
  });

  test("the tradie lookup, a Server Action, asserts the directory before its catch", () => {
    const source = read("lib/data/tradies.ts");
    const fnAt = source.indexOf("export async function getTradiesForLookup");
    const assertAt = source.indexOf(
      "assertCanReadTradieDirectory(principal)",
      fnAt,
    );
    const tryAt = source.indexOf("try {", fnAt);
    assert.ok(fnAt > 0 && assertAt > fnAt && assertAt < tryAt);
  });

  test("a project update is authorised before any photo is uploaded", () => {
    const source = read("app/api/(data)/projects/[projectId]/updates/route.ts");
    const authAt = source.indexOf("authorizeProjectRecording(");
    const putAt = source.indexOf("await put(");
    assert.ok(authAt > 0 && authAt < putAt);
  });

  test("agent annotations use the lead scope and the file rule, not their own", () => {
    const source = read("app/api/agent/annotations/route.ts");
    assert.match(source, /leadListScope\(actor\)/);
    assert.doesNotMatch(source, /assignedId: actor\.id/);
    assert.doesNotMatch(source, /lead: \{ assignedId: actor\.id \}/);
    assert.match(source, /complianceDocumentId: null/);
  });

  test("agent file reads go through canReadFile", () => {
    const source = read("app/api/agent/files/[fileId]/route.ts");
    assert.match(source, /canReadFile\(userPrincipal\(user\), file\)/);
    assert.doesNotMatch(source, /file\.uploadedBy === user\.id/);
  });

  test("cron routes refuse an unauthenticated caller outside production too", () => {
    for (const cron of [
      "comms-sweep",
      "sync-sent-mail",
      "whatsapp-sweep",
      "blob-storage-cleanup",
      "followup-lead-reminder",
      "reconcile-unconfirmed-envelope-sends",
      "graph-renew",
    ]) {
      const source = read(`app/api/cron/${cron}/route.ts`);
      assert.doesNotMatch(source, /NODE_ENV === "production"/, cron);
    }
  });

  test("the project list carries the site manager summary, not the User row", () => {
    const source = read("lib/domain/projects/queries.ts");
    assert.match(source, /siteManager: siteManagerSummary,/);
  });
});
