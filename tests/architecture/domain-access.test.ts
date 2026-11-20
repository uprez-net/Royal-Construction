import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import {
  authorizeAgentSession,
  findAgentSessionOwner,
} from "@/lib/domain/access/agent-sessions";
import {
  authorizeLead,
  canAccessLead,
  leadListScope,
} from "@/lib/domain/access/leads";
import {
  OfferSupersededError,
  authorizeOffer,
} from "@/lib/domain/access/offers";
import {
  authorizeFileAttachment,
  authorizeMilestone,
  canAttachFileToProject,
  canManageProject,
  projectManageScope,
} from "@/lib/domain/access/projects";
import {
  authorizeTradieSchedule,
  canReadTradieDirectory,
  tradieScheduleListScope,
} from "@/lib/domain/access/tradies";
import {
  DomainAuthorizationError,
  DomainNotFoundError,
} from "@/lib/domain/errors";
import { anonymousPrincipal, systemPrincipal } from "@/lib/domain/principal";
import { ROOT } from "./module-graph";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "./domain-harness";

// Phase 1 of issue #301: the shared identity and authorization primitives.
//
// Nothing here is a new rule. Each one existed already, in two or three places
// with two or three different errors, and the point of the tests is that the
// rule still decides what it always decided now that there is one of it.

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/* ---------------------------------------------------------------- leads -- */

test("lead scope: the office reads every lead, anyone else only their own", () => {
  assert.deepEqual(leadListScope(adminPrincipal()), { assignedId: null });
  // A site manager is staff for projects, not for the sales side: their lead
  // scope is their own assignments (none, today).
  assert.deepEqual(leadListScope(siteManagerPrincipal("u_sm")), {
    assignedId: "u_sm",
  });
  assert.deepEqual(leadListScope(customerPrincipal("u_c")), {
    assignedId: "u_c",
  });
  // A cron reconciling follow-ups needs every lead and has no user.
  assert.deepEqual(leadListScope(systemPrincipal("cron:followups")), {
    assignedId: null,
  });
});

test("lead scope refuses an unauthenticated caller instead of matching nothing", () => {
  // A scope that quietly matched nothing would render as "no leads" on a page
  // that should not have opened at all.
  assert.throws(
    () => leadListScope(anonymousPrincipal("book-consultation")),
    DomainAuthorizationError,
  );
});

test("the per-lead check and the list scope agree", () => {
  const lead = { assignedId: "u_c", id: 7 };
  const other = { assignedId: "u_someone", id: 8 };

  // Staff: scope is unfiltered, so the per-lead check must pass for both.
  assert.equal(canAccessLead(adminPrincipal(), lead), true);
  assert.equal(canAccessLead(adminPrincipal(), other), true);

  // Non-staff: scope narrows to their own, so the per-lead check must match.
  const customer = customerPrincipal("u_c");
  assert.equal(canAccessLead(customer, lead), true);
  assert.equal(canAccessLead(customer, other), false);
  assert.equal(leadListScope(customer).assignedId, "u_c");
});

test("authorizeLead separates a missing lead from a forbidden one", async () => {
  const missing = recordingDb({ "lead.findUnique": null });
  await assert.rejects(
    () => authorizeLead(adminPrincipal(), 7, missing.db),
    DomainNotFoundError,
  );

  const forbidden = recordingDb({
    "lead.findUnique": { assignedId: "u_other", id: 7 },
  });
  await assert.rejects(
    () => authorizeLead(customerPrincipal("u_c"), 7, forbidden.db),
    DomainAuthorizationError,
  );
});

/* --------------------------------------------------------------- offers -- */

test("an offer is reached through its lead, never through its own id", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: "u_other", id: 7 },
    "offer.findUnique": { isActive: true, leadId: 7 },
  });

  await assert.rejects(
    () => authorizeOffer(customerPrincipal("u_c"), "offer_1", recorder.db),
    DomainAuthorizationError,
  );
  // The lead lookup is the authorization: without it an offerId would be a key.
  assert.deepEqual(recorder.operations(), [
    "offer.findUnique",
    "lead.findUnique",
  ]);
});

test("a forbidden offer does not disclose that it exists", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: "u_other", id: 7 },
    "offer.findUnique": { isActive: true, leadId: 7 },
  });

  await assert.rejects(
    () => authorizeOffer(customerPrincipal("u_c"), "offer_1", recorder.db),
    (error) => {
      // Flattened to a refusal, not the lead's own 404 — an offer id is
      // guessable in a way a lead list is not.
      assert.ok(error instanceof DomainAuthorizationError);
      assert.match(error.message, /do not have access to this offer/);
      return true;
    },
  );
});

test("a superseded revision is readable but never writable", async () => {
  const script = {
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": { isActive: false, leadId: 7 },
  };

  await assert.rejects(
    () => authorizeOffer(adminPrincipal(), "offer_1", recordingDb(script).db),
    OfferSupersededError,
  );

  const read = await authorizeOffer(
    adminPrincipal(),
    "offer_1",
    recordingDb(script).db,
    { allowInactive: true },
  );
  assert.equal(read.isActive, false);
  assert.equal(read.leadId, 7);
});

test("a database failure behind an offer check is not reported as a refusal", async () => {
  const recorder = recordingDb({
    "lead.findUnique": () => {
      throw new Error("connection terminated");
    },
    "offer.findUnique": { isActive: true, leadId: 7 },
  });

  // The app's previous `catch {}` turned an outage into "you do not have
  // access", which is both wrong and impossible to diagnose from the screen.
  await assert.rejects(
    () => authorizeOffer(adminPrincipal(), "offer_1", recorder.db),
    /connection terminated/,
  );
});

/* ------------------------------------------------------------- projects -- */

test("project manage scope is an ADMIN or the project's own site manager", () => {
  const project = { id: "p_1", siteManagerId: "u_sm" };

  assert.equal(canManageProject(adminPrincipal(), project), true);
  assert.equal(canManageProject(siteManagerPrincipal("u_sm"), project), true);
  assert.equal(
    canManageProject(siteManagerPrincipal("u_other"), project),
    false,
  );
  assert.equal(canManageProject(customerPrincipal(), project), false);
  assert.equal(canManageProject(anonymousPrincipal("booking"), project), false);
  // A cron rescheduling work has no user but is trusted by its channel.
  assert.equal(
    canManageProject(systemPrincipal("cron:reminders"), project),
    true,
  );
});

test("the project filter is the per-project check, pushed into the query", () => {
  assert.deepEqual(projectManageScope(adminPrincipal()), {});
  assert.deepEqual(projectManageScope(systemPrincipal("cron")), {});
  assert.deepEqual(projectManageScope(siteManagerPrincipal("u_sm")), {
    siteManagerId: "u_sm",
  });
  assert.throws(
    () => projectManageScope(anonymousPrincipal("booking")),
    DomainAuthorizationError,
  );
});

test("a milestone is resolved to its own project, not the one named alongside it", async () => {
  const recorder = recordingDb({
    "milestone.findUnique": { projectId: "p_real" },
    "project.findUnique": {
      id: "p_real",
      location: "Kellyville",
      name: "Lot 12",
      siteManagerId: "u_sm",
    },
  });

  const { project } = await authorizeMilestone(
    siteManagerPrincipal("u_sm"),
    "m_1",
    recorder.db,
  );
  assert.equal(project.id, "p_real");
});

test("an upload naming a milestone from another project is refused, not corrected", async () => {
  const recorder = recordingDb({
    "milestone.findUnique": { projectId: "p_real" },
  });

  await assert.rejects(
    () =>
      authorizeFileAttachment(
        { role: "ADMIN" },
        { milestoneId: "m_1", projectId: "p_claimed" },
        recorder.db,
      ),
    DomainNotFoundError,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("attach scope is wider than manage scope, deliberately", async () => {
  // Staff may attach to any project — every project screen offers them the
  // upload controls — while manage scope narrows a site manager to their own.
  const project = { customerId: "c_1" };
  assert.equal(canAttachFileToProject({ role: "ADMIN" }, project), true);
  assert.equal(canAttachFileToProject({ role: "SITE_MANAGER" }, project), true);
  assert.equal(canAttachFileToProject({ role: "GUEST" }, project), true);
  assert.equal(
    canAttachFileToProject({ customerId: "c_1", role: "CUSTOMER" }, project),
    true,
  );
  assert.equal(
    canAttachFileToProject({ customerId: "c_2", role: "CUSTOMER" }, project),
    false,
  );
  // A customer with no customer row must not match a project with none either.
  assert.equal(
    canAttachFileToProject({ customerId: null, role: "CUSTOMER" }, project),
    false,
  );
  assert.equal(canAttachFileToProject({ role: "TRADIE" }, project), false);

  const recorder = recordingDb({
    "project.findUnique": { customerId: "c_1" },
  });
  assert.deepEqual(
    await authorizeFileAttachment(
      { customerId: "c_1", role: "CUSTOMER" },
      { projectId: "p_1" },
      recorder.db,
    ),
    { projectId: "p_1" },
  );
});

/* -------------------------------------------------------------- tradies -- */

test("the tradie directory is open to staff who book work, and nobody else", () => {
  assert.equal(canReadTradieDirectory(adminPrincipal()), true);
  assert.equal(canReadTradieDirectory(siteManagerPrincipal()), true);
  assert.equal(canReadTradieDirectory(customerPrincipal()), false);
  assert.equal(canReadTradieDirectory(anonymousPrincipal("booking")), false);
});

test("a booking is scoped by its own project, not one supplied alongside it", async () => {
  const recorder = recordingDb({
    "tradieSchedule.findUnique": {
      id: "s_1",
      milestoneId: null,
      project: { id: "p_1", siteManagerId: "u_sm" },
      projectId: "p_1",
      tradieId: "t_1",
    },
  });

  assert.equal(
    (
      await authorizeTradieSchedule(
        siteManagerPrincipal("u_sm"),
        "s_1",
        recorder.db,
      )
    ).projectId,
    "p_1",
  );

  await assert.rejects(
    () =>
      authorizeTradieSchedule(
        siteManagerPrincipal("u_other"),
        "s_1",
        recordingDb({
          "tradieSchedule.findUnique": {
            id: "s_1",
            milestoneId: null,
            project: { id: "p_1", siteManagerId: "u_sm" },
            projectId: "p_1",
            tradieId: "t_1",
          },
        }).db,
      ),
    DomainAuthorizationError,
  );
});

test("the schedule listing filter matches the per-booking check", () => {
  assert.deepEqual(tradieScheduleListScope(adminPrincipal()), {});
  assert.deepEqual(tradieScheduleListScope(siteManagerPrincipal("u_sm")), {
    project: { siteManagerId: "u_sm" },
  });
});

/* ------------------------------------------------------- agent sessions -- */

test("an unregistered Eve session is a race to wait out, not a refusal", async () => {
  const recorder = recordingDb({ "agentSession.findUnique": null });
  assert.equal(await findAgentSessionOwner("eve_1", recorder.db), null);
});

test("a session with a foreign owner is refused, and so is an unknown one", async () => {
  const foreign = recordingDb({
    "agentSession.findUnique": { id: "as_1", ownerUserId: "u_other" },
  });
  await assert.rejects(
    () => authorizeAgentSession("eve_1", "u_me", foreign.db),
    DomainAuthorizationError,
  );

  const unknown = recordingDb({ "agentSession.findUnique": null });
  await assert.rejects(
    () => authorizeAgentSession("eve_1", "u_me", unknown.db),
    // One message for both, so a probe cannot learn which sessions exist.
    /The agent session is unavailable\./,
  );
});

/* ------------------------------------------- the old copies are gone now -- */

test("the app's schedule guard calls the shared project rule", () => {
  const source = read("lib/data/tradieSchedules.ts");
  assert.match(source, /authorizeProject/);
  // Its own copy of the rule, which drifted from Eve's by having no shared home.
  assert.doesNotMatch(source, /project\.siteManagerId !== user\.id/);
});

test("Eve's project and tradie tools call the shared project rule", () => {
  const project = read("agent/lib/project-operations.ts");
  assert.match(project, /authorizeProject/);
  assert.doesNotMatch(project, /project\.siteManagerId !== actor\.id/);

  const tradie = read("agent/lib/tradie-operations.ts");
  assert.match(tradie, /listTradieSchedules/);
  const tradieQueries = read("lib/domain/tradies/queries.ts");
  assert.match(tradieQueries, /tradieScheduleListScope/);
  const tradieAccess = read("lib/domain/access/tradies.ts");
  assert.match(tradieAccess, /projectManageScope/);
  // Five inline spellings of the same filter.
  assert.doesNotMatch(tradie, /\{ siteManagerId: actor\.id \}/);
});

test("the lead rule has one home, and the adapters only translate its errors", () => {
  const access = read("lib/offer/access.ts");
  assert.match(access, /lib\/domain\/access\/leads/);
  assert.doesNotMatch(access, /INTERNAL_ROLES/);

  const offerAccess = read("lib/data/offer-access.ts");
  assert.match(offerAccess, /authorizeOffer/);
  // The superseded guard used to live here as an inline isActive check.
  assert.doesNotMatch(offerAccess, /offer\.isActive/);
});

test("the upload staff roles and the lead-reading roles are literally one list", () => {
  const projectAccess = read("lib/projects/project-access.ts");
  assert.match(projectAccess, /INTERNAL_ROLES/);
  // Not a second array kept in step by a test — the same array.
  assert.doesNotMatch(projectAccess, /"ADMIN"/);
});

test("the audit writer is reachable from Eve, not just from a request", () => {
  const domain = read("lib/domain/audit/action-log.ts");
  // The `import "server-only"` on lib/data/actionLog.ts is why an Eve mutation
  // wrote no activity row at all. (The words appear in a comment here; the
  // import is what matters.)
  assert.doesNotMatch(domain, /^import "server-only";/m);
  assert.match(read("lib/data/actionLog.ts"), /logActionDomain/);
});
