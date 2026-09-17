import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findInsuranceTriggerMilestoneId,
  hasInsuranceClaimDates,
  readInsuranceClaimDates,
  withInsuranceClaimDates,
  type MilestoneStageInfo,
} from "../../lib/projects/insurance-claim-dates";
import { projectExtractionSchema } from "../../lib/agent/projectExtraction-validators";

function milestone(
  overrides: Partial<MilestoneStageInfo> &
    Pick<MilestoneStageInfo, "id" | "order">,
): MilestoneStageInfo {
  return {
    parentId: null,
    status: "PENDING",
    projectStage: "Slab",
    ...overrides,
  } as MilestoneStageInfo;
}

test("the trigger is the earliest Slab milestone, not the earliest milestone", () => {
  const milestones = [
    milestone({ id: "deposit-1", order: 1, projectStage: "Deposit" }),
    milestone({ id: "deposit-2", order: 2, projectStage: "Deposit" }),
    milestone({ id: "slab-1", order: 3 }),
    milestone({ id: "slab-2", order: 4 }),
    milestone({ id: "frame-1", order: 20, projectStage: "Frame" }),
  ];

  assert.equal(findInsuranceTriggerMilestoneId(milestones), "slab-1");
});

test("a parent Slab milestone is skipped in favour of its first child", () => {
  // The milestone card only offers "Start Activity" on leaves, so pinning the
  // prompt to a parent would mean it never fires.
  const milestones = [
    milestone({ id: "slab-parent", order: 3 }),
    milestone({ id: "slab-child-a", order: 4, parentId: "slab-parent" }),
    milestone({ id: "slab-child-b", order: 5, parentId: "slab-parent" }),
  ];

  assert.equal(findInsuranceTriggerMilestoneId(milestones), "slab-child-a");
});

test("a Slab milestone marked not required is skipped", () => {
  const milestones = [
    milestone({ id: "slab-1", order: 3, status: "NOT_REQUIRED" }),
    milestone({ id: "slab-2", order: 4 }),
  ];

  assert.equal(findInsuranceTriggerMilestoneId(milestones), "slab-2");
});

test("a project with no Slab milestones has no trigger", () => {
  const milestones = [
    milestone({ id: "deposit-1", order: 1, projectStage: "Deposit" }),
  ];

  assert.equal(findInsuranceTriggerMilestoneId(milestones), null);
  assert.equal(findInsuranceTriggerMilestoneId([]), null);
});

test("both dates are required before the prompt stops firing", () => {
  assert.equal(hasInsuranceClaimDates(undefined), false);
  assert.equal(hasInsuranceClaimDates({}), false);
  assert.equal(
    hasInsuranceClaimDates({
      legalAdministration: {
        siteAddress: null,
        ownerContacts: { names: [], emails: [], phones: [] },
        commencementTrigger: null,
        signedDate: null,
        pcaInspector: null,
        hbcfInsuranceNumber: null,
        hbcfInsuranceDocument: null,
        insuranceClaimStartDate: "2026-09-01",
      },
    }),
    false,
  );
  assert.equal(
    hasInsuranceClaimDates({
      legalAdministration: {
        siteAddress: null,
        ownerContacts: { names: [], emails: [], phones: [] },
        commencementTrigger: null,
        signedDate: null,
        pcaInspector: null,
        hbcfInsuranceNumber: null,
        hbcfInsuranceDocument: null,
        insuranceClaimStartDate: "2026-09-01",
        insuranceClaimEndDate: "2027-09-01",
      },
    }),
    true,
  );
});

test("saving the dates leaves every other requirements section untouched", () => {
  const existing = {
    version: 1 as const,
    projectName: "Penrith residence",
    legalAdministration: {
      siteAddress: "1 Example St",
      ownerContacts: { names: ["Jo"], emails: [], phones: [] },
      commencementTrigger: "Executed contract",
      signedDate: "2026-01-05",
      pcaInspector: "Inspector",
      hbcfInsuranceNumber: null,
      hbcfInsuranceDocument: null,
    },
    subStructureAndGround: {
      concreteSlabClass: "Class H1",
      concreteStrengthMpa: 32,
      vapourBarrier: null,
      termiteSystem: null,
      sewerConnection: null,
    },
  };

  const next = withInsuranceClaimDates(existing, {
    insuranceClaimStartDate: "2026-09-01",
    insuranceClaimEndDate: "2027-09-01",
  });

  assert.equal(next.projectName, "Penrith residence");
  assert.deepEqual(next.subStructureAndGround, existing.subStructureAndGround);
  assert.equal(next.legalAdministration?.siteAddress, "1 Example St");
  assert.equal(next.legalAdministration?.pcaInspector, "Inspector");
  assert.deepEqual(readInsuranceClaimDates(next), {
    insuranceClaimStartDate: "2026-09-01",
    insuranceClaimEndDate: "2027-09-01",
  });
});

test("the merged payload is accepted by the project PATCH schema", () => {
  // The kickoff prompt and the Overview tab both PATCH the whole requirements
  // payload, so a merge that the route rejects would block the milestone start.
  const merged = withInsuranceClaimDates(null, {
    insuranceClaimStartDate: "2026-09-01",
    insuranceClaimEndDate: "2027-09-01",
  });

  const result = projectExtractionSchema.safeParse(merged);

  assert.equal(result.success, true);
  assert.equal(
    result.success && result.data.legalAdministration.insuranceClaimEndDate,
    "2027-09-01",
  );
});
