import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { OfferStatus } from "@prisma/client";

import {
  assertTransitionAllowed,
  commitOfferStatusTransition,
} from "../../lib/domain/offers/status";
import {
  OFFER_WORKSPACE_PATCH_KEYS,
  applyOfferWorkspacePatch,
} from "../../lib/domain/offers/workspace-save";
import { saveContractParticulars } from "../../lib/domain/offers/contract-particulars";
import { EMPTY_CONTRACT_PARTICULARS } from "../../lib/offer/contract-particulars";
import { DomainTransitionError } from "../../lib/domain/errors";
import { ROOT } from "./module-graph";
import { adminPrincipal, recordingDb } from "./domain-harness";

// Phase 3 of issue #301: offers.
//
// Everything here is customer-visible — a quoted price, a GST total, a
// contract status, a signing state. A rule that disagrees between the app and
// Eve shows a customer one number and the office another, and there is no
// support team to catch it.
//
// Note what these tests are able to do at all: lib/domain/offers/* is
// Node-safe, so a test can import the save and the state machine and actually
// run them. The "use server" originals could only ever be scanned as text.

const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

/* ------------------------------------------------------- the state machine */

test("a manual jump into a signed state is refused outside development", () => {
  // These states must be reached through a real DocuSign completion: the
  // Connect webhook is what archives the executed PDF, and a status flip with
  // no PDF behind it produces an empty project (issue #90). Eve's copy of the
  // transition had no such guard, so an agent could do it in production.
  const previous = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    for (const signed of [
      OfferStatus.OFFER_SIGNED,
      OfferStatus.TENDER_SIGNED,
      OfferStatus.CONTRACT_SIGNED,
    ]) {
      assert.throws(
        () => assertTransitionAllowed(OfferStatus.SENT, signed),
        (error) => {
          assert.ok(error instanceof DomainTransitionError);
          assert.match(error.message, /complete signing via DocuSign/);
          return true;
        },
        `${signed} was allowed`,
      );
    }
  } finally {
    if (previous === undefined) {
      // NODE_ENV is typed readonly, so restoring "unset" goes through
      // Reflect, for the same reason the assignment above goes through
      // Object.assign.
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      Object.assign(process.env, { NODE_ENV: previous });
    }
  }
});

test("stepping back from a document out for signature names the recall action", () => {
  assert.throws(
    () => assertTransitionAllowed(OfferStatus.OFFER_SENT, OfferStatus.SENT),
    (error) => {
      // The customer keeps a live signing link until the envelope is voided,
      // so the refusal has to say which action actually does that.
      assert.ok(error instanceof DomainTransitionError);
      assert.match(error.message, /Recall envelope/);
      return true;
    },
  );
});

test("a transition whose row moved underneath it returns null, not success", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": {
      isActive: true,
      leadId: 7,
      offerStatus: OfferStatus.SENT,
      workspaceState: null,
    },
    // The conditional write matched nothing: someone else moved the offer.
    "offer.updateMany": { count: 0 },
  });

  const result = await commitOfferStatusTransition(
    adminPrincipal(),
    { offerId: "offer_1", toStatus: OfferStatus.PENDING },
    recorder.db,
  );

  assert.equal(result, null);
  // Crucially, no status event: the timeline must not record a move that did
  // not happen.
  assert.deepEqual(
    recorder.writes().map((call) => call.operation),
    ["offer.updateMany"],
  );
});

test("a superseded revision cannot be transitioned", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": {
      isActive: false,
      leadId: 7,
      offerStatus: OfferStatus.SENT,
      workspaceState: null,
    },
  });

  await assert.rejects(
    () =>
      commitOfferStatusTransition(
        adminPrincipal(),
        { offerId: "offer_1", toStatus: OfferStatus.PENDING },
        recorder.db,
      ),
    // authorizeOffer refuses a superseded revision for a write before the
    // transition is even considered.
    (error) => error instanceof Error,
  );
  assert.deepEqual(recorder.writes(), []);
});

test("the transition's predicate pins the status it decided against", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": {
      isActive: true,
      leadId: 7,
      offerStatus: OfferStatus.SENT,
      workspaceState: null,
    },
    "offer.updateMany": { count: 1 },
    "offerStatusEvent.create": {},
  });

  const result = await commitOfferStatusTransition(
    adminPrincipal(),
    {
      expectedStateVersion: 4,
      offerId: "offer_1",
      toStatus: OfferStatus.PENDING,
    },
    recorder.db,
  );

  assert.deepEqual(result, {
    from: OfferStatus.SENT,
    to: OfferStatus.PENDING,
  });

  const write = recorder.writes()[0];
  assert.deepEqual(write.args, {
    data: { offerStatus: OfferStatus.PENDING },
    where: {
      id: "offer_1",
      isActive: true,
      // isActive and offerStatus are in the predicate, not just checked above:
      // a send or a revision fork landing in between must not let this through.
      offerStatus: OfferStatus.SENT,
      stateVersion: 4,
    },
  });
});

test("a delegated transition refuses a status that changed before commit", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": {
      isActive: true,
      leadId: 7,
      offerStatus: OfferStatus.TENDER_SENT,
      workspaceState: null,
    },
  });

  const result = await commitOfferStatusTransition(
    adminPrincipal(),
    {
      expectedFromStatus: OfferStatus.OFFER_SENT,
      offerId: "offer_1",
      skipTransitionCheck: true,
      toStatus: OfferStatus.SENT,
    },
    recorder.db,
  );

  assert.equal(result, null);
  assert.deepEqual(recorder.writes(), []);
});

test("the lead-stage sync is not part of the transition", () => {
  // Eve's copy wrote the lead's stage inside the same transaction. A failure
  // there rolls the status flip and its OfferStatusEvent back while
  // $transaction still resolves — so the tool reported a status change that
  // had been discarded, and nothing retried it.
  const source = read("lib/domain/offers/status.ts");
  assert.doesNotMatch(source, /leadStagePatchForOfferStatus/);
  assert.doesNotMatch(source, /lead\.update/);
});

/* ------------------------------------------------------- the workspace save */

test("a patch naming an unknown section is refused, never merged", async () => {
  const recorder = recordingDb({});
  const result = await applyOfferWorkspacePatch(
    adminPrincipal(),
    {
      expectedStateVersion: 1,
      offerId: "offer_1",
      patch: { costLines: [], somethingElse: true },
    },
    recorder.db,
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "invalid");
  // Refused before it read anything at all, let alone wrote.
  assert.deepEqual(recorder.operations(), []);
});

test("the patch allowlist covers every section a workspace has", () => {
  // A section missing from the list is not a safe default — it means an agent
  // cannot edit it and gets "unsupported section" for a real part of the offer.
  for (const key of [
    "job",
    "costLines",
    "allowances",
    "exclusions",
    "draft",
    "areaCalculator",
    "pricingSettings",
    "paymentSchedule",
    "images",
  ]) {
    assert.ok(OFFER_WORKSPACE_PATCH_KEYS.has(key), `${key} is not patchable`);
  }
});

test("a patch against an offer with no saved workspace is refused", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": { isActive: true, leadId: 7, workspaceState: null },
  });

  const result = await applyOfferWorkspacePatch(
    adminPrincipal(),
    { expectedStateVersion: 1, offerId: "offer_1", patch: { draft: {} } },
    recorder.db,
  );

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "invalid");
  assert.deepEqual(recorder.writes(), []);
});

test("a patch on a superseded revision says superseded, not stale", async () => {
  // They need different recoveries: a stale version reconciles against the
  // same revision, a superseded one has to move to whichever is now live.
  // Eve's copy could only ever say "stale".
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": { isActive: false, leadId: 7, workspaceState: {} },
  });

  const result = await applyOfferWorkspacePatch(
    adminPrincipal(),
    { expectedStateVersion: 1, offerId: "offer_1", patch: { draft: {} } },
    recorder.db,
  );

  assert.equal(result.ok === false && result.reason, "superseded");
});

test("contract particulars map a superseded revision to a failed result", async () => {
  const recorder = recordingDb({
    "lead.findUnique": { assignedId: null, id: 7 },
    "offer.findUnique": { isActive: false, leadId: 7 },
  });

  const result = await saveContractParticulars(
    adminPrincipal(),
    {
      manualOverrides: [],
      offerId: "offer_1",
      particulars: EMPTY_CONTRACT_PARTICULARS,
    },
    recorder.transactionalDb,
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /superseded/);
  assert.deepEqual(recorder.writes(), []);
});

/* ------------------------------------------ the duplicate really is deleted */

test("Eve's offer specialist no longer carries the save or the state machine", () => {
  const source = read("agent/lib/offer-operations.ts");
  for (const gone of [
    "planWorkspaceSave",
    "validatePersistedWorkspace",
    "splitContractValueByGst",
    "buildProposalInput",
    "collectOwnerIssues",
    "requiresOwnerGate",
    "classifyOfferTransition",
    "leadStagePatchForOfferStatus",
  ]) {
    assert.doesNotMatch(source, new RegExp(gone), `${gone} is still here`);
  }
  assert.match(source, /@\/lib\/domain\/offers\/workspace-save/);
  assert.match(source, /@\/lib\/domain\/offers\/status/);
});

test("Eve syncs the lead stage after its audited transaction, not inside it", () => {
  const source = read("agent/lib/offer-operations.ts");
  const fn = source.slice(
    source.indexOf("export async function transitionAuthorizedOfferStatus("),
  );
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.match(body, /syncLeadStageForOffer/);
  // After runOfferMutation returns — i.e. after the transaction has committed.
  assert.ok(
    body.indexOf("runOfferMutation") < body.indexOf("syncLeadStageForOffer"),
    "the stage sync runs inside the audited transaction again",
  );
});

test("offer saves sync the lead value only after their transaction commits", () => {
  const domain = read("lib/domain/offers/workspace-save.ts");
  const save = domain.slice(
    domain.indexOf("export async function saveOfferWorkspace("),
    domain.indexOf("export async function syncLeadDealValue("),
  );
  assert.doesNotMatch(save, /syncLeadDealValue\(/);

  const agent = read("agent/lib/offer-operations.ts");
  const update = agent.slice(
    agent.indexOf("export async function updateAuthorizedOfferDetails("),
    agent.indexOf("export async function recallAuthorizedOfferEnvelope("),
  );
  assert.ok(
    update.indexOf("await runOfferMutation(") <
      update.indexOf("await syncLeadDealValue("),
    "Eve syncs the lead value before its audited transaction commits",
  );
});

test("Eve syncs the lead stage after a successful recall transaction", () => {
  const source = read("agent/lib/offer-operations.ts");
  const recall = source.slice(
    source.indexOf("export async function recallAuthorizedOfferEnvelope("),
    source.indexOf("export async function createAuthorizedOfferRevision("),
  );
  assert.ok(
    recall.indexOf("await runOfferMutation(") <
      recall.indexOf("await syncLeadStageForOffer("),
    "the recall lead-stage sync runs inside the audited transaction",
  );
});

test("the app's save and commit are adapters over the domain now", () => {
  const source = read("lib/data/offer-workspace.ts");
  assert.match(source, /saveOfferWorkspaceDomain/);
  assert.match(source, /commitOfferStatusTransition/);
  // The money maths left with the rule it belongs to.
  assert.doesNotMatch(source, /splitContractValueByGst/);
  assert.doesNotMatch(source, /collectOwnerIssues/);
  // The cache expiry and the post-commit stage sync stay, because they cannot
  // leave Next.
  assert.match(source, /revalidateTag/);
  assert.match(source, /syncLeadStageForOffer/);
});
